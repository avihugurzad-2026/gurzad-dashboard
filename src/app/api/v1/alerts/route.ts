import { authed, json } from '@/server/http';
import { integrity } from '@/server/data';

export const GET = authed(async () => {
  const { today, alerts } = await integrity();
  return json({ today, ...alerts });
});
