import { authed, json } from '@/server/http';
import { ospa, parseBasis } from '@/server/revenue';

export const GET = authed(async (req: Request) => {
  const basis = parseBasis(new URL(req.url).searchParams.get('basis'));
  return json(await ospa(basis));
});
