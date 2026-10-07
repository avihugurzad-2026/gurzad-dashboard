import { timingSafeEqual } from 'node:crypto';
import { json } from '@/server/http';
import { db } from '@/server/db';
import gcal from '@domain/gcal';

export const dynamic = 'force-dynamic';

// Daily Vercel Cron. Vercel sends `Authorization: Bearer $CRON_SECRET`; without the
// secret configured the route is closed.
function allowed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!allowed(req)) return json({ error: 'unauthorized' }, 401);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const keyB64 = process.env.CALENDAR_TOKEN_KEY;
  if (!clientId || !clientSecret || !keyB64) return json({ ok: true, skipped: 'not_configured' });

  const { rows } = await db().query(
    `SELECT id, user_id, refresh_token_encrypted FROM calendar_connections WHERE status = 'connected' ORDER BY created_at`);
  const results = [];
  for (const c of rows) {
    try {
      const r = await gcal.syncConnection(db(), c, { clientId, clientSecret, keyB64 });
      results.push({ id: c.id, ok: r.ok, error: r.error ?? null, calendars: r.calendars.length });
    } catch (e) {
      console.error('Calendar cron sync failed:', e instanceof gcal.GoogleError ? e.code : 'error');
      results.push({ id: c.id, ok: false, error: 'sync_failed', calendars: 0 });
    }
  }
  const ok = results.every(r => r.ok);
  return json({ ok, connections: results }, ok ? 200 : 502);
}
