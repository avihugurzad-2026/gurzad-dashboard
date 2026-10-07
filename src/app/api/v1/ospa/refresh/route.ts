import { authed, json } from '@/server/http';
import { ingestOspa } from '@/server/ingest';

// "רענן עכשיו" on the Head Spa page. Writes to Supabase only.
export const POST = authed(async () => {
  const r = await ingestOspa();
  return r.ok ? json(r) : json({ error: r.error }, 502);
});
