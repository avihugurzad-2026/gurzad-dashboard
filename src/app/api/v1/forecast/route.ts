import { authed, json } from '@/server/http';
import { forecast } from '@/server/data';

export const GET = authed(async () => json(await forecast()));
