import { timingSafeEqual } from 'node:crypto';
import { json } from '@/server/http';
import { cronRun } from '@/server/calendar';

export const dynamic = 'force-dynamic';

// Daily Vercel Cron (Hobby allows daily only). Syncs every connected user's calendars and renews
// push channels that expire within 48h. Between runs, push notifications and the page-load
// refresh (ensureFreshEvents) keep events fresh. Vercel sends `Authorization: Bearer
// $CRON_SECRET`; without the secret configured the route is closed.
function allowed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!allowed(req)) return json({ error: 'unauthorized' }, 401);
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.CALENDAR_TOKEN_KEY) {
    return json({ ok: true, skipped: 'not_configured' });
  }
  const r = await cronRun();
  return json(r, r.ok ? 200 : 502);
}
