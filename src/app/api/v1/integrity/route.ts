import { authed, json } from '@/server/http';
import { integrity } from '@/server/data';

export const GET = authed(async () => json(await integrity()));
