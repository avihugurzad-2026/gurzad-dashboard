import { authed, json } from '@/server/http';
import { currentUser } from '@/server/auth';
import { syncIntegrations } from '@/server/integrations';

// "רענן מ-Buyz" on the Head Spa pages (admins). Same sync as the daily cron; writes to Supabase only.
export const POST = authed(async () => {
  const u = await currentUser();
  const r = await syncIntegrations(u?.id ?? null);
  return r.ok ? json(r) : json({ error: r.error ?? 'הסנכרון נכשל' }, 502);
});
