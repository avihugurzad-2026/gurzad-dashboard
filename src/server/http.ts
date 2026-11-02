import 'server-only';
import { NextResponse } from 'next/server';
import { currentUser, type SessionUser } from './auth';

const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

// Authenticated JSON handler: 401 when signed out, 403 for non-admins on admin routes (the
// whole-business vault data), 500 without leaking internals. Handlers that filter per user
// pass { admin: false } and read the user with currentUser().
export function authed<A extends unknown[]>(fn: (...args: A) => Promise<Response>, { admin = true }: { admin?: boolean } = {}) {
  return async (...args: A): Promise<Response> => {
    const u: SessionUser | null = await currentUser();
    if (!u) return json({ error: 'לא מחובר' }, 401);
    if (admin && !u.isAdmin) return json({ error: 'אין הרשאה' }, 403);
    try {
      return await fn(...args);
    } catch (err) {
      console.error(err);
      return json({ error: 'שגיאת שרת' }, 500);
    }
  };
}
