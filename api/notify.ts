import { isCron, handler, HttpError, requireMember, sbAdmin } from './_lib/server.js';
import { notifyWorkspace, pushReady, notifyEvent } from './_lib/push.js';
import { mailAssigned, mailDueReminders, mailReady, mailTest } from './_lib/reminders.js';
import { pushAll } from './_lib/google.js';
import { metaCampaignsReady, runMetaDailyAgent, sendMetaYesterdayWhatsAppReport } from './_lib/meta-campaigns.js';

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
    try { if (pushReady() && isFridayIL()) r.weekly = await weeklySpend(id); } catch (e) { console.error('weekly failed', id, e); r.weekly = { error: true }; }
    try { r.mail = await mailDueReminders(id); } catch (e) { console.error('reminders failed', id, e); r.mail = { error: true }; }
    try {
      if (metaCampaignsReady()) {
        const rev = await runMetaDailyAgent(id, 7);
        r.metaAgent = { count: rev.recommendations.length };
        if (pushReady() && rev.recommendations.length > 0) {
          await notifyEvent(id, {
            id: 'meta-agent-' + rev.date,
            level: rev.recommendations.some((x) => x.priority === 'high') ? 'warn' : 'info',
            area: 'business',
            title: 'סקירת קמפיינים במטא מוכנה',
            detail: `${rev.recommendations.length} המלצות אופטימיזציה ממתינות לאישור באדיג׳יטל`,
            to: '/meta-campaigns',
            sort: -35,
          });
        }
        try {
          r.metaWhatsApp = await sendMetaYesterdayWhatsAppReport(id);
        } catch (we) {
          console.error('meta wa daily report failed', id, we);
          r.metaWhatsApp = { error: true };
        }
      }
    } catch (e) { console.error('meta agent cron failed', id, e); r.metaAgent = { error: true }; }
    out[id] = r;
  }
  let google: unknown = null;
  try { google = await pushAll(); } catch (e) { console.error('google sync failed', e); google = { error: true }; }
  // housekeeping: used/expired login codes older than a day, mail log older than 60 days
  await sb.from('gd_otp').delete().lt('expires_at', new Date(Date.now() - 864e5).toISOString());
  await sb.from('gd_notify_log').delete().eq('level', 'mail').lt('last_sent_at', new Date(Date.now() - 60 * 864e5).toISOString());
  res.json({ ok: true, workspaces: (wss ?? []).length, result: out, google });
});

/** Friday (Israel time): push "how much we spent this week" like a chat message. */
function isFridayIL() {
  return new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }) === 'Fri';
}
async function weeklySpend(workspaceId: string) {
  const sb = sbAdmin();
  const now = new Date();
  const ilNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const start = new Date(ilNow); start.setDate(start.getDate() - 6);
  const from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  const { data } = await sb.from('gd_records').select('data').eq('workspace_id', workspaceId).in('collection', ['transactions', 'biz_expenses']);
  let total = 0, count = 0;
  for (const r of data ?? []) {
    const d = r.data as any;
    if (!d?.date || d.date < from) continue;
    if (d.kind && d.kind !== 'הוצאה') continue;
    total += Number(d.amount ?? d.amount_gross ?? 0); count++;
  }
  const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(total);
  return notifyEvent(workspaceId, { id: 'weekly-' + from, level: 'info', area: 'home', title: 'סיכום שבוע', detail: `השבוע הוצאתם ${ils} ב-${count} הוצאות`, to: '/home', sort: -40 });
}
