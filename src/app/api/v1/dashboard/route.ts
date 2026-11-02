import { authed, json } from '@/server/http';
import { overview, resolveWorkspace } from '@/server/data';
import { parseRange } from '@/lib/period';

export const GET = authed(async (req: Request) => {
  const url = new URL(req.url);
  const branch = await resolveWorkspace(url.searchParams.get('w'));
  return json(await overview(branch, parseRange(url.searchParams.get('range'))));
});
