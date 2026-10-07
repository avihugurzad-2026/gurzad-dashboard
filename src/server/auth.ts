import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

export const COOKIE = 'token';
export const SESSION_HOURS = 8;

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET env var is required');
  return s;
}

export function signSession(): string {
  return jwt.sign({ role: 'owner' }, secret(), { expiresIn: `${SESSION_HOURS}h` });
}

export async function isAuthed(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return false;
  try {
    jwt.verify(token, secret());
    return true;
  } catch {
    return false;
  }
}

// Pages: send a signed-out visitor to the login screen
export async function requireUser(): Promise<void> {
  if (!(await isAuthed())) redirect('/login');
}

// Route handlers: a 401 response when signed out, null when allowed
export async function apiGuard(): Promise<NextResponse | null> {
  if (await isAuthed()) return null;
  return NextResponse.json({ error: 'לא מחובר' }, { status: 401 });
}
