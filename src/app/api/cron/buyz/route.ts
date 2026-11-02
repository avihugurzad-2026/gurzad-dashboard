import { timingSafeEqual } from 'node:crypto';
import { json } from '@/server/http';
import { syncIntegrations } from '@/server/integrations';

// Daily Vercel Cron. Vercel sends `Authorization: Bearer $CRON_SECRET`; without the
// secret configured the route is closed. Syncs every integration that is not disabled
// (today: Buyz per Head Spa branch) and logs each sync in activity_log.
function allowed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!allowed(req)) return json({ error: 'unauthorized' }, 401);
  const r = await syncIntegrations(null);
  return r.ok ? json(r) : json(r, 502);
}
