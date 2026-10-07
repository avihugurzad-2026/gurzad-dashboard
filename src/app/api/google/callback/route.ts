import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isAuthed } from '@/server/auth';
import { db } from '@/server/db';
import gcal from '@domain/gcal';

export const dynamic = 'force-dynamic';

function sameState(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Google OAuth callback: store the refresh token (encrypted), the account's calendars as
// mappings, then a first sync. Every outcome lands on /settings?calendar=<result>.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const done = (result: string) => {
    const res = NextResponse.redirect(new URL(`/settings?calendar=${result}`, req.url));
    res.headers.set('Cache-Control', 'no-store');
    res.cookies.set('gcal_state', '', { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0, path: '/api/google' });
    return res;
  };
  if (!(await isAuthed())) return NextResponse.redirect(new URL('/login', req.url));

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const keyB64 = process.env.CALENDAR_TOKEN_KEY;
  if (!clientId || !clientSecret || !keyB64) return done('not_configured');

  const cookieState = (await cookies()).get('gcal_state')?.value;
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code || !sameState(url.searchParams.get('state'), cookieState)) return done('error');

  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${url.origin}/api/google/callback`;
  try {
    const tok = await gcal.exchangeCode({ code, clientId, clientSecret, redirectUri });
    if (!tok.refresh_token) return done('no_refresh');
    const calendars = await gcal.listCalendars(tok.access_token);
    const email = calendars.find(c => c.primary)?.id ?? null;
    if (!email) return done('error');

    const client = await db().connect();
    let connection;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO calendar_connections (user_id, provider, google_account_email, refresh_token_encrypted, status, last_error)
         VALUES ('avihu', 'google', $1, $2, 'connected', NULL)
         ON CONFLICT (user_id, provider, google_account_email) DO UPDATE SET
           refresh_token_encrypted = EXCLUDED.refresh_token_encrypted, status = 'connected', last_error = NULL, updated_at = now()
         RETURNING id, user_id, refresh_token_encrypted`,
        [email, gcal.encryptToken(tok.refresh_token, keyB64)]);
      connection = rows[0];
      // New calendars get a default; existing rows keep their settings (only name/color refresh)
      for (const c of calendars) {
        await client.query(
          `INSERT INTO calendar_mappings (connection_id, google_calendar_id, calendar_name, color, is_enabled)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (connection_id, google_calendar_id) DO UPDATE SET
             calendar_name = EXCLUDED.calendar_name, color = EXCLUDED.color`,
          [connection.id, c.id, c.name, c.color, c.primary || c.access_role === 'owner']);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    try {
      await gcal.syncConnection(db(), connection, { clientId, clientSecret, keyB64 });
    } catch {
      console.error('Calendar first sync failed (will retry)');
    }
    return done('connected');
  } catch (e) {
    console.error('Google callback failed:', e instanceof gcal.GoogleError ? e.code : 'error');
    return done('error');
  }
}
