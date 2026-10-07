import { cookies, headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { COOKIE, SESSION_HOURS, signSession } from '@/server/auth';
import { allow } from '@/server/ratelimit';
import { json } from '@/server/http';

export async function POST(req: Request) {
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!allow(ip)) return json({ error: 'יותר מדי ניסיונות. נסה שוב בעוד 15 דקות.' }, 429);

  const hash = process.env.OWNER_PASSWORD_HASH;
  if (!hash) return json({ error: 'השרת לא מוגדר (OWNER_PASSWORD_HASH)' }, 500);

  const body = await req.json().catch(() => ({}));
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!password) return json({ error: 'סיסמה נדרשת' }, 400);
  if (!(await bcrypt.compare(password, hash))) return json({ error: 'סיסמה שגויה' }, 401);

  (await cookies()).set(COOKIE, signSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // false on localhost so Safari accepts it
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  });
  return json({ ok: true });
}
