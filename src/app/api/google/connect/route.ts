import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import gcal from '@domain/gcal';

export const dynamic = 'force-dynamic';

// Start Google OAuth for the signed-in user (calendar.events + calendar.readonly). The state is
// kept in a short-lived httpOnly cookie.
export async function GET(req: Request) {
  if (!(await currentUser())) return NextResponse.redirect(new URL('/login', req.url));
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET || !process.env.CALENDAR_TOKEN_KEY) {
    return NextResponse.redirect(new URL('/settings?calendar=not_configured', req.url));
  }
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${new URL(req.url).origin}/api/google/callback`;
  const state = randomBytes(32).toString('base64url');
  const res = NextResponse.redirect(gcal.authUrl({ clientId, redirectUri, state }));
  res.headers.set('Cache-Control', 'no-store');
  res.cookies.set('gcal_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/api/google' });
  return res;
}
