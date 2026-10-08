import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import gcal from '@domain/gcal';

export const dynamic = 'force-dynamic';

// Start Google OAuth for the signed-in user (calendar.events + calendar.readonly). `?with=gmail`
// also asks for gmail.readonly (incremental: include_granted_scopes keeps earlier grants) and
// makes the callback return to /finance-import/gmail. The state, and which flow started it, are
// kept in short-lived httpOnly cookies.
export async function GET(req: Request) {
  if (!(await currentUser())) return NextResponse.redirect(new URL('/login', req.url));
  const withGmail = new URL(req.url).searchParams.get('with') === 'gmail';
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET || !process.env.CALENDAR_TOKEN_KEY) {
    return NextResponse.redirect(new URL(withGmail ? '/finance-import/gmail?gmail=not_configured' : '/settings?calendar=not_configured', req.url));
  }
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${new URL(req.url).origin}/api/google/callback`;
  const state = randomBytes(32).toString('base64url');
  const res = NextResponse.redirect(gcal.authUrl({ clientId, redirectUri, state, extraScopes: withGmail ? [gcal.SCOPE_GMAIL] : [] }));
  res.headers.set('Cache-Control', 'no-store');
  const cookie = { httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: 600, path: '/api/google' };
  res.cookies.set('gcal_state', state, cookie);
  res.cookies.set('gcal_flow', withGmail ? 'gmail' : '', withGmail ? cookie : { ...cookie, maxAge: 0 });
  return res;
}
