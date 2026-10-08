import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { db } from './db';

// Sessions and permissions. The JWT only says who signed in; roles and scopes are read from
// workspace_members on every request, so revoking access takes effect at once.
//
// Workspace isolation (src/lib/workspaces.ts):
//   personal  (domain 'personal')  only its owner, ever. No membership, not even the account owner's, opens it.
//   household (domain 'household') its members only. The account owner is not a member by default.
//   business / ventures            members of that workspace (a membership may narrow to one branch);
//                                  the account owner and global admins see them all.

export const COOKIE = 'token';
export const SESSION_HOURS = 8;
export const OWNER_ID = 'avihu';

export type Role = 'owner' | 'admin' | 'manager' | 'member' | 'employee' | 'viewer';
export type Membership = { role: Role; domain: string | null; branch: string | null; location: string | null; workspace_id?: string | null };
export type SessionUser = { id: string; name: string; isOwner: boolean; isAdmin: boolean; memberships: Membership[] };
export type PlaceRef = { domain: string | null; branch?: string | null; location?: string | null };

// What each kind of record needs. Your own rows are always yours; these roles open the shared
// rows of the places your memberships cover. Owner sees and does everything.
export type Kind = 'task' | 'event' | 'money' | 'goal' | 'inbox';
// 'owner' here is a workspace owner (a household or business someone else created); the account
// owner is handled separately (isOwner). 'member' is a household member: reads and writes the
// household's shared rows like a manager.
const READ: Record<Kind, Role[]> = {
  task: ['owner', 'admin', 'manager', 'member', 'viewer'],             // employee: only tasks assigned to them
  event: ['owner', 'admin', 'manager', 'member', 'employee', 'viewer'],
  money: ['owner', 'admin', 'manager', 'member', 'viewer'],
  goal: ['owner', 'admin', 'manager', 'member', 'employee', 'viewer'],
  inbox: ['owner', 'admin', 'manager', 'member'],
};
const WRITE: Record<Kind, Role[]> = {
  task: ['owner', 'admin', 'manager', 'member'],
  event: ['owner', 'admin', 'manager', 'member'],
  money: ['owner', 'admin', 'manager', 'member'],
  goal: ['owner', 'admin', 'manager', 'member'],
  inbox: ['owner', 'admin', 'manager', 'member'],
};
// Who may add their own records in a place at all (viewer is read-only)
const CREATE: Role[] = ['owner', 'admin', 'manager', 'member', 'employee'];

// Areas a global (domain NULL) membership never opens: each person's private area, and households
const PRIVATE_DOMAINS = ['personal', 'household'];

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET env var is required');
  return s;
}

export function signSession(userId: string): string {
  return jwt.sign({ sub: userId }, secret(), { expiresIn: `${SESSION_HOURS}h` });
}

// Tokens from before stage 2 carry { role: 'owner' } and no sub: they are the owner's
function tokenUserId(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const p = jwt.verify(token, secret()) as jwt.JwtPayload;
    if (typeof p.sub === 'string') return p.sub;
    return p.role === 'owner' ? OWNER_ID : null;
  } catch {
    return null;
  }
}

const missing = (e: unknown) => (e as { code?: string })?.code === '42P01' || (e as { code?: string })?.code === '42703';

async function loadUser(id: string): Promise<SessionUser | null> {
  const { rows } = await db().query(`SELECT id, name, active FROM users WHERE id = $1`, [id]).catch(e => {
    if (missing(e) && id === OWNER_ID) return { rows: [{ id, name: 'אביהו', active: true }] };
    throw e;
  });
  const u = rows[0];
  if (!u || !u.active) return null;
  let memberships: Membership[];
  try {
    ({ rows: memberships } = await db().query(
      `SELECT role, domain, branch, location, workspace_id FROM workspace_members WHERE user_id = $1 AND revoked_at IS NULL`, [id]).catch(e => {
        if ((e as { code?: string })?.code !== '42703') throw e;   // before the workspaces migration
        return db().query(`SELECT role, domain, branch, location FROM workspace_members WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
      }));
  } catch (e) {
    if (!missing(e)) throw e;
    memberships = id === OWNER_ID ? [{ role: 'owner', domain: null, branch: null, location: null }] : [];
  }
  // The owner stays the owner even if the membership table is edited by hand
  if (id === OWNER_ID && !memberships.some(m => m.role === 'owner' && m.domain === null)) memberships.push({ role: 'owner', domain: null, branch: null, location: null });
  const isOwner = memberships.some(m => m.role === 'owner' && m.domain === null);
  const isAdmin = isOwner || memberships.some(m => m.role === 'admin' && m.domain === null);
  return { id: u.id, name: u.name, isOwner, isAdmin, memberships };
}

// The signed-in user for this request, or null. Cached per request.
// Also loads the workspace/branch registry, so every page that asks who is signed in can rely on it.
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const id = tokenUserId((await cookies()).get(COOKIE)?.value);
  if (!id) return null;
  const [u] = await Promise.all([loadUser(id), import('./workspaces').then(m => m.loadRegistry())]);
  return u;
});

export async function isAuthed(): Promise<boolean> {
  return (await currentUser()) !== null;
}

// Pages: a signed-out visitor goes to the login screen
export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect('/login');
  return u;
}

// Pages that show whole-business data from the vault (insights, review, scorecard …): owner/admin
export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (!u.isAdmin) notFound();
  return u;
}

// Pages of one place: any membership that covers it
export async function requirePlace(p: PlaceRef, kind: Kind = 'task'): Promise<SessionUser> {
  const u = await requireUser();
  if (!canSeePlace(u, p, kind)) notFound();
  return u;
}

// Route handlers: a 401 response when signed out, null when allowed
export async function apiGuard(): Promise<NextResponse | null> {
  if (await isAuthed()) return null;
  return NextResponse.json({ error: 'לא מחובר' }, { status: 401 });
}

// ── Place checks (TypeScript side, for pages, forms and writes) ──────────────
function covers(m: Membership, p: PlaceRef): boolean {
  if (m.domain === null) return !PRIVATE_DOMAINS.includes(p.domain ?? '');
  if (!p.domain || m.domain !== p.domain) return false;
  if (m.branch !== null && m.branch !== (p.branch ?? null)) return false;
  if (m.location !== null && m.location !== (p.location ?? null)) return false;
  return true;
}

// A place is "visible" when it, or something inside it, is covered: a Modiin manager can open the
// Head Spa Israel page (it shows only Modiin rows), but not a-digital.
function touches(m: Membership, p: PlaceRef): boolean {
  if (m.domain === null) return !PRIVATE_DOMAINS.includes(p.domain ?? '');
  if (!p.domain) return false;
  if (m.domain !== p.domain) return false;
  if (p.branch && m.branch && m.branch !== p.branch) return false;
  if (p.location && m.location && m.location !== p.location) return false;
  return true;
}

export function canSeePlace(u: SessionUser, p: PlaceRef, kind: Kind = 'task'): boolean {
  if (p.domain === 'personal') return true;          // everyone has their own personal workspace
  if (u.isOwner && p.domain !== 'household') return true;
  const roles = kind === 'task' ? [...READ.task, 'employee'] : READ[kind];
  return u.memberships.some(m => roles.includes(m.role) && touches(m, p));
}

// May this user add a record of their own in this place?
export function canCreateIn(u: SessionUser, p: PlaceRef, kind: Kind): boolean {
  if (p.domain === 'personal') return true;          // rows there are always the creator's own
  if (u.isOwner && p.domain !== 'household') return true;
  const roles = kind === 'task' || kind === 'inbox' ? CREATE : WRITE[kind];
  return u.memberships.some(m => roles.includes(m.role) && covers(m, p));
}

// May this user change an existing row? (its place, owner and scope)
export function canEditRow(
  u: SessionUser, kind: Kind,
  row: PlaceRef & { owner_user_id?: string | null; scope?: string | null; assigned_to?: string | null },
): boolean {
  if (row.owner_user_id === u.id) return true;
  if (row.domain === 'personal') return false;       // someone else's personal row
  if (u.isOwner && row.domain !== 'household') return true;
  if (kind === 'task' && row.assigned_to === u.id) return true;
  if (row.scope !== 'shared') return false;
  return u.memberships.some(m => WRITE[kind].includes(m.role) && covers(m, row));
}

// Deleting a shared row someone else owns: owner, or a manager of that place. Admin may not (spec 2.1).
export function canDeleteRow(u: SessionUser, kind: Kind, row: PlaceRef & { owner_user_id?: string | null; scope?: string | null }): boolean {
  if (row.owner_user_id === u.id) return true;
  if (row.domain === 'personal') return false;
  if (u.isOwner && row.domain !== 'household') return true;
  if (row.scope !== 'shared') return false;
  return u.memberships.some(m => ['owner', 'manager', 'member'].includes(m.role) && covers(m, row) && WRITE[kind].includes(m.role));
}

// ── Row filter (SQL side). Every list query goes through this, so the database does the filtering.
// `p` appends a parameter and returns its placeholder. `alias` is the table alias with
// owner_user_id, scope, domain, branch, location columns. Tasks also check assigned_to.
export function visibleSql(u: SessionUser, kind: Kind, alias: string, p: (v: unknown) => string,
  cols: { owner?: string | null; scope?: string | null; assigned?: string | null } = {}): string {
  const a = alias ? `${alias}.` : '';
  const owner = cols.owner === undefined ? `${a}owner_user_id` : cols.owner;
  const scope = cols.scope === undefined ? `${a}scope` : cols.scope;
  const dom = `${a}domain`;
  // Account owner: their own rows, every shared business/ventures row, and the households they belong to.
  // Someone else's personal workspace stays closed, whatever its rows' scope says.
  if (u.isOwner && (!owner || !scope)) return `(${dom} <> 'household' OR ${hhMember(u, a, p, READ[kind])})`;
  const me = p(u.id);
  const parts: string[] = [];
  if (owner) parts.push(`${owner} = ${me}`);
  if (kind === 'task' && cols.assigned !== null) parts.push(`(${cols.assigned ?? `${a}assigned_to`} = ${me} AND ${dom} <> 'personal')`);
  const roles = p(READ[kind]);
  const member = `EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.user_id = ${me} AND wm.revoked_at IS NULL
      AND wm.role = ANY(${roles}::text[])
      AND ((wm.domain IS NULL AND ${dom} NOT IN ('personal', 'household')) OR (wm.domain = ${dom}
        AND (wm.branch IS NULL OR wm.branch = ${a}branch)
        AND (wm.location IS NULL OR wm.location = ${a}location))))`;
  const shared = u.isOwner ? `(${dom} IN ('business', 'ventures') OR ${member})` : member;
  parts.push(scope ? `(${scope} = 'shared' AND ${shared})` : `(${dom} <> 'personal' AND ${shared})`);
  return `(${parts.join(' OR ')})`;
}

// A household membership test for rows with no owner/scope columns
function hhMember(u: SessionUser, a: string, p: (v: unknown) => string, roles: Role[]): string {
  return `EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.user_id = ${p(u.id)} AND wm.revoked_at IS NULL
      AND wm.role = ANY(${p(roles)}::text[]) AND wm.domain = 'household' AND wm.branch = ${a}branch)`;
}

// Small helper for building parameterised SQL: const q = params(); q.p(value) → "$1"
export function params(start: unknown[] = []) {
  const values = [...start];
  return { values, p: (v: unknown) => { values.push(v); return `$${values.length}`; } };
}
