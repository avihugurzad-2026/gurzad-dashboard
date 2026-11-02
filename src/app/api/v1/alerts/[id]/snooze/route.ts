import { authed, json } from '@/server/http';
import { snoozeAlert } from '@/server/data';
import { todayIL } from '@/lib/period';

// The dashboard's write path for alerts: Supabase only, never the vault
export const POST = authed(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const result = await snoozeAlert(Number(id), body?.until, todayIL());
  if (result === 'invalid') return json({ error: 'תאריך הדחייה חייב להיות תאריך עתידי' }, 400);
  if (result === 'not_found') return json({ error: 'ההתראה לא נמצאה או כבר נסגרה' }, 404);
  return json({ ok: true, id: Number(id), snoozed_until: body.until });
});
