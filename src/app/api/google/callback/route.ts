import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { db } from '@/server/db';
import { startWatching } from '@/server/calendar';
import gcal from '@domain/gcal';

export const dynamic = 'force-dynamic';

function sameState(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Google OAuth callback for the signed-in user: store the refresh token (encrypted) and the
// granted scopes, the account's calendars as mappings (with their access role), then a first
// sync and push channels. Every outcome lands on /settings?calendar=<result>.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const done = (result: string) => {
    const res = NextResponse.redirect(new URL(`/settings?calendar=${result}`, req.url));
    res.headers.set('Cache-Control', 'no-store');
    res.cookies.set('gcal_state', '', { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0, path: '/api/google' });
    return res;
  };
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));

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
        `INSERT INTO calendar_connections (user_id, provider, google_account_email, refresh_token_encrypted, status, last_error, scopes)
         VALUES ($3, 'google', $1, $2, 'connected', NULL, $4)
         ON CONFLICT (user_id, provider, google_account_email) DO UPDATE SET
           refresh_token_encrypted = EXCLUDED.refresh_token_encrypted, status = 'connected', last_error = NULL,
           scopes = EXCLUDED.scopes, updated_at = now()
         RETURNING id, user_id, refresh_token_encrypted`,
        [email, gcal.encryptToken(tok.refresh_token, keyB64), user.id, gcal.parseScopes(tok.scope).list.join(' ') || null]);
      connection = rows[0];
      // New calendars get a default; existing rows keep their settings (only name/color refresh)
      for (const c of calendars) {
        await client.query(
          `INSERT INTO calendar_mappings (connection_id, google_calendar_id, calendar_name, color, is_enabled, access_role, is_default_write)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (connection_id, google_calendar_id) DO UPDATE SET
             calendar_name = EXCLUDED.calendar_name, color = EXCLUDED.color, access_role = EXCLUDED.access_role`,
          [connection.id, c.id, c.name, c.color, c.primary || c.access_role === 'owner', c.access_role, false]);
      }
      // Exactly one default write calendar: keep the user's choice, else the primary calendar
      await client.query(
        `UPDATE calendar_mappings m SET is_default_write = (m.google_calendar_id = $2)
         WHERE m.connection_id = $1 AND NOT EXISTS (
           SELECT 1 FROM calendar_mappings d WHERE d.connection_id = $1 AND d.is_default_write AND d.google_calendar_id <> $2)`,
        [connection.id, email]);
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
    await startWatching(connection.id);
    return done('connected');
  } catch (e) {
    console.error('Google callback failed:', e instanceof gcal.GoogleError ? e.code : 'error');
    return done('error');
  }
}
