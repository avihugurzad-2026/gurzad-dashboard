import { isCron, handler, HttpError, requireMember, sbAdmin } from './_lib/server.js';
import { notifyWorkspace, pushReady } from './_lib/push.js';
import { mailAssigned, mailDueReminders, mailReady, mailTest } from './_lib/reminders.js';
import { pushAll } from './_lib/google.js';

// GET  (Vercel cron, daily ~07:10 Israel time, CRON_SECRET): phone pushes for new alerts, email reminders
//      for tasks/events N days ahead, and the daily dashboard → Google Calendar sync.
// POST { action: 'assigned', collection, id } (signed-in member): email the person just assigned.
// POST { action: 'test', subject, body }      (owner): send the template to yourself.
export default handler(async (req, res) => {
  if (req.method === 'POST') {
    const me = await requireMember(req);
    if (!mailReady()) throw new HttpError(503, 'שירות המייל לא מוגדר');
    const b = req.body ?? {};
    const from = String(me.user.user_metadata?.name || me.user.email || '');
    if (b.action === 'assigned') { res.json({ sent: await mailAssigned(me.workspaceId, String(b.collection), String(b.id), from) }); return; }
    if (b.action === 'test') {
      if (me.role !== 'owner') throw new HttpError(403, 'רק הבעלים');
      await mailTest(me.user.email!, String(b.subject || '').slice(0, 200), String(b.body || '').slice(0, 4000), from);
      res.json({ ok: true });
      return;
    }
    throw new HttpError(400, 'פעולה לא מוכרת');
  }

  if (!isCron(req.headers.authorization)) throw new HttpError(401, 'לא מורשה');
  const sb = sbAdmin();
  const { data: wss } = await sb.from('gd_workspaces').select('id');
  const out: Record<string, unknown> = {};
  for (const { id } of wss ?? []) {
    const r: Record<string, unknown> = {};
    try { if (pushReady()) r.push = await notifyWorkspace(id); } catch (e) { console.error('notify failed', id, e); r.push = { error: true }; }
    try { r.mail = await mailDueReminders(id); } catch (e) { console.error('reminders failed', id, e); r.mail = { error: true }; }
    out[id] = r;
  }
  let google: unknown = null;
  try { google = await pushAll(); } catch (e) { console.error('google sync failed', e); google = { error: true }; }
  // housekeeping: used/expired login codes older than a day, mail log older than 60 days
  await sb.from('gd_otp').delete().lt('expires_at', new Date(Date.now() - 864e5).toISOString());
  await sb.from('gd_notify_log').delete().eq('level', 'mail').lt('last_sent_at', new Date(Date.now() - 60 * 864e5).toISOString());
  res.json({ ok: true, workspaces: (wss ?? []).length, result: out, google });
});
