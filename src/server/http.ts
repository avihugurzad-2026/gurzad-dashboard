import 'server-only';
import { NextResponse } from 'next/server';
import { apiGuard } from './auth';

const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

// Authenticated JSON handler: 401 when signed out, 500 without leaking internals
export function authed<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const denied = await apiGuard();
    if (denied) return denied;
    try {
      return await fn(...args);
    } catch (err) {
      console.error(err);
      return json({ error: 'שגיאת שרת' }, 500);
    }
  };
}
