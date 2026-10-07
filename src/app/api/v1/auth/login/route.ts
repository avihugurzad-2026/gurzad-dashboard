import { cookies, headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { COOKIE, OWNER_ID, SESSION_HOURS, signSession } from '@/server/auth';
import { allow } from '@/server/ratelimit';
import { json } from '@/server/http';
import { db } from '@/server/db';

// Two ways in: the owner's password alone (as before), or email + password for invited users.
export async function POST(req: Request) {
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!allow(ip)) return json({ error: 'יותר מדי ניסיונות. נסה שוב בעוד 15 דקות.' }, 429);

  const body = await req.json().catch(() => ({}));
  const password = typeof body?.password === 'string' ? body.password : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!password) return json({ error: 'סיסמה נדרשת' }, 400);

  let userId: string | null = null;
  if (!email) {
    const hash = process.env.OWNER_PASSWORD_HASH;
    if (!hash) return json({ error: 'השרת לא מוגדר (OWNER_PASSWORD_HASH)' }, 500);
    if (await bcrypt.compare(password, hash)) userId = OWNER_ID;
  } else {
    const { rows } = await db().query(
      `SELECT id, password_hash FROM users WHERE lower(email) = $1 AND active AND password_hash IS NOT NULL`, [email])
      .catch(() => ({ rows: [] as { id: string; password_hash: string }[] }));
    // Compare against a dummy hash when there is no such user, so timing does not reveal who exists
    const hash = rows[0]?.password_hash ?? '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.uPq5c3s2vZp0l1e0ZcQ0q9C5r1e2';
    if ((await bcrypt.compare(password, hash)) && rows[0]) userId = rows[0].id;
  }
  if (!userId) return json({ error: email ? 'אימייל או סיסמה שגויים' : 'סיסמה שגויה' }, 401);

  await db().query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]).catch(() => {});
  (await cookies()).set(COOKIE, signSession(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // false on localhost so Safari accepts it
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  });
  return json({ ok: true });
}
