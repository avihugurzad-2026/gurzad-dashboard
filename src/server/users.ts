import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { OWNER_ID, type Membership, type Role, type SessionUser } from './auth';
import { contextLabel } from '@/lib/places';

// Users, memberships and invitations (stage 2.1). Who may manage whom:
//   owner  → everyone, any role but owner
//   admin  → everyone, roles below admin; cannot touch the owner
//   manager → employees/viewers inside the places they manage
// There is no mail server: an invitation is a link the inviter sends (copy, or "send by email"
// which opens their own mail app). Only the link's sha256 is stored. Links last 7 days.

export const INVITE_DAYS = 7;
export const MIN_PASSWORD = 10;
const RANK: Record<Role, number> = { owner: 5, admin: 4, manager: 3, member: 3, employee: 2, viewer: 1 };
export const ROLE_LABEL: Record<Role, string> = {
  owner: 'בעלים', admin: 'מנהל מערכת', manager: 'מנהל', member: 'חבר', employee: 'עובד', viewer: 'צפייה בלבד',
};
export const ROLE_HINT: Record<Exclude<Role, 'owner'>, string> = {
  admin: 'מנהל ישויות ומשתמשים, בלי למחוק נתונים משותפים',
  manager: 'מנהל את מה שבתחום שלו: משימות, יומן, כספים',
  employee: 'רואה ומעדכן משימות שהוקצו לו',
  member: 'שותף מלא בבית: רואה ומעדכן את מה שמשותף',
  viewer: 'קריאה בלבד',
};

type Place = { domain: string | null; branch: string | null; location: string | null };
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function placeLabel(p: Place): string {
  return p.domain ? contextLabel({ domain: p.domain, branch: p.branch, location: p.location }) : 'הכל';
}

const coversPlace = (m: Membership, p: Place) =>
  m.domain === null || (m.domain === p.domain && (m.branch === null || m.branch === p.branch) && (m.location === null || m.location === p.location));

// May `u` grant `role` on `place`?
export function canGrant(u: SessionUser, role: Role, place: Place): boolean {
  if (role === 'owner' || place.domain === 'personal') return false;   // a personal workspace has no members
  // A workspace's own owner/admin manages its members (households, and businesses someone created)
  if (place.domain && u.memberships.some(m => (m.role === 'owner' || (m.role === 'admin' && role !== 'admin'))
    && m.domain === place.domain && (m.branch === null || m.branch === place.branch))) return true;
  if (place.domain === 'household') return false;                       // households: only their own admins
  if (u.isOwner) return true;
  if (u.isAdmin) return RANK[role] < RANK.admin;
  if (role !== 'employee' && role !== 'viewer') return false;
  return u.memberships.some(m => m.role === 'manager' && coversPlace(m, place));
}

export const canManageUsers = (u: SessionUser) => u.isAdmin || u.memberships.some(m => m.role === 'manager');

export type UserRow = {
  id: string; name: string; email: string | null; active: boolean; can_sign_in: boolean; last_login_at: string | null;
  members: { id: string; role: Role; place: Place; label: string; revocable: boolean }[];
};
export type InviteRow = { id: string; email: string; name: string | null; role: Role; label: string; expires_at: string; invited_by: string };

export async function listUsers(u: SessionUser): Promise<{ users: UserRow[]; invites: InviteRow[] }> {
  const { rows: users } = await db().query(
    `SELECT id, name, email, active, password_hash IS NOT NULL AS can_sign_in, last_login_at FROM users ORDER BY active DESC, name`);
  const { rows: members } = await db().query(
    `SELECT id, user_id, role, domain, branch, location FROM workspace_members WHERE revoked_at IS NULL ORDER BY created_at`);
  const { rows: invites } = await db().query(
    `SELECT id, email, name, role, domain, branch, location, expires_at, invited_by FROM invitations
     WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`);
  // A manager sees only the people and invitations inside their places
  const visible = (p: Place) => u.isAdmin || u.memberships.some(m => m.role === 'manager' && coversPlace(m, p));
  const out: UserRow[] = users.map(r => ({
    id: r.id, name: r.name, email: r.email, active: r.active, can_sign_in: r.can_sign_in,
    last_login_at: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
    members: members.filter(m => m.user_id === r.id).map(m => {
      const place = { domain: m.domain, branch: m.branch, location: m.location };
      return { id: m.id, role: m.role, place, label: placeLabel(place), revocable: m.role !== 'owner' && canGrant(u, m.role, place) && r.id !== u.id };
    }).filter(m => visible(m.place)),
  })).filter(r => u.isAdmin || r.members.length > 0 || r.id === u.id);
  return {
    users: out,
    invites: invites.filter(i => visible(i)).map(i => ({
      id: i.id, email: i.email, name: i.name, role: i.role, label: placeLabel(i), invited_by: i.invited_by,
      expires_at: new Date(i.expires_at).toISOString(),
    })),
  };
}

// Users that can be (re)activated by an invitation: they exist but cannot sign in yet
export async function pendingUsers(): Promise<{ id: string; name: string }[]> {
  const { rows } = await db().query(`SELECT id, name FROM users WHERE password_hash IS NULL AND id <> $1 ORDER BY name`, [OWNER_ID]);
  return rows;
}

export async function createInvitation(u: SessionUser, input: { email: string; name: string | null; user_id: string | null; role: Role; place: Place }):
  Promise<{ ok: true; token: string; id: string } | { ok: false; error: string }> {
  if (!canGrant(u, input.role, input.place)) return { ok: false, error: 'אין לך הרשאה לתת את התפקיד הזה במקום הזה' };
  if (input.place.domain === null && input.role !== 'admin') return { ok: false, error: 'צריך לבחור לאן הגישה' };
  // Binding a link to an existing account that has no password yet lets whoever accepts it set
  // that account's password and inherit its rows. Only account-level admins may do that, by id or
  // by that account's email. (An account that already signs in must prove its current password.)
  if (input.user_id) {
    if (!u.isAdmin) return { ok: false, error: 'רק מנהל מערכת יכול להזמין משתמש קיים' };
    const { rows } = await db().query(`SELECT 1 FROM users WHERE id = $1 AND id <> $2`, [input.user_id, OWNER_ID]);
    if (!rows.length) return { ok: false, error: 'משתמש לא קיים' };
  } else if (!u.isAdmin) {
    const { rows } = await db().query(`SELECT 1 FROM users WHERE lower(email) = lower($1) AND password_hash IS NULL`, [input.email]);
    if (rows.length) return { ok: false, error: 'האימייל שייך למשתמש קיים שעוד לא נכנס. רק מנהל מערכת יכול להזמין אותו.' };
  }
  const token = randomBytes(32).toString('base64url');
  const { rows } = await db().query(
    `INSERT INTO invitations (email, name, user_id, role, domain, branch, location, token_hash, expires_at, invited_by, workspace_id)
     VALUES (lower($1), $2, $3, $4, $5, $6, $7, $8, now() + make_interval(days => $9), $10,
       CASE WHEN $5::text IS NULL THEN NULL ELSE app_workspace_for($5, $6, NULL) END) RETURNING id`,
    [input.email, input.name, input.user_id, input.role, input.place.domain, input.place.branch, input.place.location,
      sha256(token), INVITE_DAYS, u.id]);
  return { ok: true, token, id: rows[0].id };
}

export type InviteView = { email: string; name: string | null; role: Role; label: string; existing: boolean; needs_current_password: boolean };

// Public: what a link is for, or null when it's unknown/used/expired (looked up by its hash)
export async function inviteByToken(token: string): Promise<(InviteView & { id: string; user_id: string | null; place: Place }) | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const hash = sha256(token);
  const { rows } = await db().query(
    `SELECT i.*, u.password_hash IS NOT NULL AS has_password, u.id AS match_id
     FROM invitations i
     LEFT JOIN users u ON u.id = i.user_id OR (i.user_id IS NULL AND lower(u.email) = i.email)
     WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`, [hash]);
  const r = rows[0];
  if (!r) return null;
  const place = { domain: r.domain, branch: r.branch, location: r.location };
  return {
    id: r.id, user_id: r.match_id ?? null, email: r.email, name: r.name, role: r.role, place, label: placeLabel(place),
    existing: Boolean(r.match_id), needs_current_password: Boolean(r.has_password),
  };
}

// Accept: create or activate the user, add the membership, mark the link used. Returns the user id.
export async function acceptInvitation(token: string, input: { name: string; password: string; current_password: string | null }):
  Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const inv = await inviteByToken(token);
  if (!inv) return { ok: false, error: 'הקישור לא בתוקף. בקש קישור חדש.' };
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const { rows: lock } = await client.query(
      `SELECT 1 FROM invitations WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`, [inv.id]);
    if (!lock.length) { await client.query('ROLLBACK'); return { ok: false, error: 'הקישור כבר נוצל' }; }
    let userId: string;
    if (inv.user_id) {
      const { rows } = await client.query(`SELECT password_hash FROM users WHERE id = $1 FOR UPDATE`, [inv.user_id]);
      const existingHash: string | null = rows[0]?.password_hash ?? null;
      if (existingHash) {
        // Someone who already signs in proves it's them; their password stays as it is
        if (!input.current_password || !(await bcrypt.compare(input.current_password, existingHash))) {
          await client.query('ROLLBACK');
          return { ok: false, error: 'הסיסמה הנוכחית שגויה' };
        }
      } else {
        // Activating an account that never signed in: only from a link an account admin made
        // (also covers links made before this check existed)
        const { rows: by } = await client.query(
          `SELECT 1 FROM invitations i
           WHERE i.id = $1 AND (i.invited_by = $2 OR EXISTS (SELECT 1 FROM workspace_members m
             WHERE m.user_id = i.invited_by AND m.domain IS NULL AND m.role IN ('owner', 'admin') AND m.revoked_at IS NULL))`,
          [inv.id, OWNER_ID]);
        if (!by.length) { await client.query('ROLLBACK'); return { ok: false, error: 'הקישור הזה לא יכול להפעיל חשבון קיים. בקש קישור ממנהל המערכת.' }; }
        if (input.password.length < MIN_PASSWORD) { await client.query('ROLLBACK'); return { ok: false, error: `סיסמה של לפחות ${MIN_PASSWORD} תווים` }; }
        await client.query(
          `UPDATE users SET name = $2, email = $3, password_hash = $4, active = true WHERE id = $1`,
          [inv.user_id, input.name, inv.email, await bcrypt.hash(input.password, 12)]);
      }
      userId = inv.user_id;
    } else {
      if (input.password.length < MIN_PASSWORD) { await client.query('ROLLBACK'); return { ok: false, error: `סיסמה של לפחות ${MIN_PASSWORD} תווים` }; }
      userId = await freeUserId(client, inv.email);
      await client.query(`INSERT INTO users (id, name, email, password_hash, active) VALUES ($1, $2, $3, $4, true)`,
        [userId, input.name, inv.email, await bcrypt.hash(input.password, 12)]);
    }
    await client.query(
      `INSERT INTO workspace_members (user_id, role, domain, branch, location, created_by, workspace_id)
       SELECT $1, i.role, i.domain, i.branch, i.location, i.invited_by, i.workspace_id FROM invitations i WHERE i.id = $2
       ON CONFLICT DO NOTHING`, [userId, inv.id]);
    await client.query(`UPDATE invitations SET accepted_at = now(), user_id = $2 WHERE id = $1`, [inv.id, userId]);
    await client.query(`INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, 'invitation', $2, 'accept', $3)`,
      [userId, inv.id, JSON.stringify({ role: inv.role, place: inv.place })]);
    await client.query('COMMIT');
    return { ok: true, userId };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// "eden@x.com" → "eden", then "eden-2" … (users.id is ^[a-z][a-z0-9-]{1,30}$)
async function freeUserId(client: { query: (s: string, p: unknown[]) => Promise<{ rows: unknown[] }> }, email: string): Promise<string> {
  let base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 24);
  if (base.length < 2) base = 'user';
  for (let i = 1; i < 100; i++) {
    const id = i === 1 ? base : `${base}-${i}`;
    const { rows } = await client.query(`SELECT 1 FROM users WHERE id = $1`, [id]);
    if (!rows.length) return id;
  }
  return `user-${randomBytes(4).toString('hex')}`;
}

export async function revokeInvitation(u: SessionUser, id: string): Promise<boolean> {
  const { rows } = await db().query(`SELECT role, domain, branch, location FROM invitations WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`, [id]);
  if (!rows[0] || !canGrant(u, rows[0].role, rows[0])) return false;
  await db().query(`UPDATE invitations SET revoked_at = now() WHERE id = $1`, [id]);
  return true;
}

// Taking access away is immediate: the next request reads memberships again
export async function revokeMembership(u: SessionUser, id: string): Promise<boolean> {
  const { rows } = await db().query(`SELECT user_id, role, domain, branch, location FROM workspace_members WHERE id = $1 AND revoked_at IS NULL`, [id]);
  const m = rows[0];
  if (!m || m.user_id === u.id || m.role === 'owner' || !canGrant(u, m.role, m)) return false;
  await db().query(`UPDATE workspace_members SET revoked_at = now() WHERE id = $1`, [id]);
  return true;
}
