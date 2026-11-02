import { authed, json } from '@/server/http';
import { resolveWorkspace, tasks } from '@/server/data';

export const GET = authed(async (req: Request) => {
  const branch = await resolveWorkspace(new URL(req.url).searchParams.get('w'));
  return json(await tasks(branch));
});
