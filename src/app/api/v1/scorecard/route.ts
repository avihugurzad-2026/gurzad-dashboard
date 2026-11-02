import { authed, json } from '@/server/http';
import { scorecard } from '@/server/data';

export const GET = authed(async () => json(await scorecard()));
