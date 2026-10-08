'use server';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, SESSION_HOURS, currentUser, signSession, type Role } from '@/server/auth';
import { db } from '@/server/db';
import { allow } from '@/server/ratelimit';
import { decodePlace } from '@/lib/places';
import { acceptInvitation, createInvitation, MIN_PASSWORD, revokeInvitation, revokeMembership } from '@/server/users';

// Users and invitations (stage 2.1). Permission rules live in src/server/users.ts (canGrant).

export type InviteResult = { ok: true; link: string; email: string } | { ok: false; error: string } | null;
type Result = { ok: true } | { ok: false; error: string };

const ROLES = new Set<Role>(['admin', 'manager', 'member', 'employee', 'viewer']);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

async function origin(): Promise<string> {
  const env = process.env.APP_URL;
  if (env) return env.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function inviteUser(_: InviteResult, f: FormData): Promise<InviteResult> {
  const u = await currentUser();
  if (!u) return { ok: false, error: 'לא מחובר' };
  const email = str(f, 'email')?.toLowerCase() ?? null;
  if (!email || !EMAIL.test(email) || email.length > 200) return { ok: false, error: 'אימייל לא תקין' };
  const name = str(f, 'name');
  if (name && name.length > 60) return { ok: false, error: 'השם ארוך מדי' };
  const role = str(f, 'role') as Role | null;
  if (!role || !ROLES.has(role)) return { ok: false, error: 'בחר תפקיד' };
  const packed = str(f, 'place');
  const place = packed === 'all' ? { domain: null, branch: null, location: null } : packed ? decodePlace(packed) : null;
  if (!place) return { ok: false, error: 'בחר לאן הגישה' };
  const userId = str(f, 'user_id');
  if (userId && !/^[a-z][a-z0-9-]{1,30}$/.test(userId)) return { ok: false, error: 'משתמש לא תקין' };
  const r = await createInvitation(u, { email, name, user_id: userId, role, place });
  if (!r.ok) return r;
  await db().query(`INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, 'invitation', $2, 'create', $3)`,
    [u.id, r.id, JSON.stringify({ role, place })]);
  revalidatePath('/settings');
  return { ok: true, link: `${await origin()}/invite/${r.token}`, email };
}

export async function cancelInvitation(id: string): Promise<Result> {
  const u = await currentUser();
  if (!u) return { ok: false, error: 'לא מחובר' };
  if (!UUID.test(id) || !(await revokeInvitation(u, id))) return { ok: false, error: 'אין לך הרשאה לזה' };
  await db().query(`INSERT INTO activity_log (user_id, object_type, object_id, action) VALUES ($1, 'invitation', $2, 'revoke')`, [u.id, id]);
  revalidatePath('/settings');
  return { ok: true };
}

export async function removeAccess(id: string): Promise<Result> {
  const u = await currentUser();
  if (!u) return { ok: false, error: 'לא מחובר' };
  if (!UUID.test(id) || !(await revokeMembership(u, id))) return { ok: false, error: 'אין לך הרשאה לזה' };
  await db().query(`INSERT INTO activity_log (user_id, object_type, object_id, action) VALUES ($1, 'membership', $2, 'revoke')`, [u.id, id]);
  revalidatePath('/settings');
  return { ok: true };
}

// Public (from the invitation link): set name and password, sign in, go home
export async function acceptInvite(_: Result | null, f: FormData): Promise<Result> {
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!allow(ip)) return { ok: false, error: 'יותר מדי ניסיונות. נסה שוב בעוד 15 דקות.' };
  const token = str(f, 'token') ?? '';
  const name = str(f, 'name') ?? '';
  if (name.length < 2 || name.length > 60) return { ok: false, error: 'כתוב שם (2 עד 60 תווים)' };
  const password = typeof f.get('password') === 'string' ? String(f.get('password')) : '';
  const confirm = typeof f.get('confirm') === 'string' ? String(f.get('confirm')) : '';
  const current = str(f, 'current_password');
  if (!current) {
    if (password.length < MIN_PASSWORD || password.length > 200) return { ok: false, error: `סיסמה של לפחות ${MIN_PASSWORD} תווים` };
    if (password !== confirm) return { ok: false, error: 'הסיסמאות לא זהות' };
  }
  const r = await acceptInvitation(token, { name, password, current_password: current });
  if (!r.ok) return r;
  (await cookies()).set(COOKIE, signSession(r.userId), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: SESSION_HOURS * 3600,
  });
  redirect('/');
}
