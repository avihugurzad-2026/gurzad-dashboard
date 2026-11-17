import { env, handler, HttpError, sbAdmin } from './_lib/server';
import { notifyWorkspace, pushReady } from './_lib/push';

// Vercel cron (daily, 07:00–08:00 Israel time): computes the same alerts the dashboard shows and
// pushes what is new to every registered phone. Protected by CRON_SECRET.
export default handler(async (req, res) => {
  if (!env('CRON_SECRET') || req.headers.authorization !== `Bearer ${env('CRON_SECRET')}`) throw new HttpError(401, 'לא מורשה');
  if (!pushReady()) { res.json({ ok: true, skipped: 'push not configured' }); return; }
  const sb = sbAdmin();
  const { data: subs } = await sb.from('gd_push_subscriptions').select('workspace_id');
  const ids = [...new Set((subs ?? []).map((s) => s.workspace_id as string))];
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    try { out[id] = await notifyWorkspace(id); } catch (e) { console.error('notify failed', id, e); out[id] = { error: true }; }
  }
  // housekeeping: used/expired login codes older than a day
  await sb.from('gd_otp').delete().lt('expires_at', new Date(Date.now() - 864e5).toISOString());
  res.json({ ok: true, workspaces: ids.length, result: out });
});
