import { authed, json } from '@/server/http';
import { disconnect } from '@/server/calendar';

export const POST = authed(async () => {
  await disconnect();
  return json({ ok: true });
});
