import { authed, json } from '@/server/http';
import { setGoal } from '@/server/data';

// Goals lock for 13 weeks; quarterly_planning:true is the explicit override
export const PUT = authed(async (req: Request, ctx: { params: Promise<{ key: string }> }) => {
  const { key } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const r = await setGoal(key, body?.weekly_goal, body?.quarterly_planning === true);
  return json(r.body, r.status);
});
