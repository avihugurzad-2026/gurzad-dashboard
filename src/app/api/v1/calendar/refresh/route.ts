import { authed, json } from '@/server/http';
import { syncNow } from '@/server/calendar';

export const POST = authed(async () => {
  const r = await syncNow();
  return json(r, r.ok ? 200 : 502);
}, { admin: false });
