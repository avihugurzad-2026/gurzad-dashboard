import { authed, json } from '@/server/http';
import { review, saveReview } from '@/server/data';
import reviewLib from '@domain/review';

export const GET = authed(async () => json(await review()));

export const POST = authed(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const r = await saveReview(body?.decisions, body?.notes, reviewLib.validateDecisions);
  return json(r.body, r.status);
});
