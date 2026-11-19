import { env, has, sbAdmin } from './server.js';
import { sendMail, templateMail } from './mail.js';
import { PLAN_COLLECTIONS, SETTINGS_KEY, addDaysIso, catHex, categoryOf, dateOf, fillTemplate, mergeReminders, varsFor, type ReminderSettings } from '../../shared/planner.js';
import { todayIL } from './google.js';

// Email reminders to whoever a task or event is assigned to.
// Only addresses on the workspace's member list are ever written to, and each mail is sent once (gd_notify_log).
export const mailReady = () => has('RESEND_API_KEY', 'MAIL_FROM');
const appUrl = () => (env('APP_URL') || '').replace(/\/$/, '');

async function workspaceBits(workspaceId: string) {
  const sb = sbAdmin();
  const { data } = await sb.from('gd_records').select('id, collection, data').eq('workspace_id', workspaceId).in('collection', ['settings', 'members']);
  const settings = mergeReminders((data ?? []).find((r) => r.collection === 'settings' && (r.data as any).key === SETTINGS_KEY)?.data as any);
  const emails = new Set((data ?? []).filter((r) => r.collection === 'members').map((r) => String((r.data as any).email || '').toLowerCase()).filter(Boolean));
  const owner = (data ?? []).find((r) => r.collection === 'members' && (r.data as any).role === 'owner');
  return { settings, emails, ownerName: String((owner?.data as any)?.name || '') };
}
async function once(workspaceId: string, logId: string, send: () => Promise<void>) {
  const sb = sbAdmin();
  const { data: seen } = await sb.from('gd_notify_log').select('alert_id').eq('workspace_id', workspaceId).eq('alert_id', logId).maybeSingle();
  if (seen) return false;
  await send();
  await sb.from('gd_notify_log').upsert({ workspace_id: workspaceId, alert_id: logId, level: 'mail', last_sent_at: new Date().toISOString() }, { onConflict: 'workspace_id,alert_id' });
  return true;
}
function compose(s: ReminderSettings, kind: 'assign' | 'before', collection: string, rec: Record<string, any>, from: string) {
  const vars = varsFor(collection, rec, { from, url: `${appUrl()}/planner/day` });
  const cat = categoryOf(collection, rec);
  return templateMail(fillTemplate(s[`${kind}_subject`], vars), fillTemplate(s[`${kind}_body`], vars), { color: catHex(cat), category: cat, url: `${appUrl()}/planner/day` });
}

/** Right after someone was assigned in the app. */
export async function mailAssigned(workspaceId: string, collection: string, id: string, fromName: string) {
  if (!mailReady() || !(PLAN_COLLECTIONS as readonly string[]).includes(collection)) return false;
  const { data: row } = await sbAdmin().from('gd_records').select('data').eq('id', id).eq('workspace_id', workspaceId).eq('collection', collection).maybeSingle();
  const rec = row?.data as any;
  const to = String(rec?.assignee_email || '').toLowerCase();
  if (!rec || !to || rec.done) return false;
  const { settings, emails } = await workspaceBits(workspaceId);
  if (!settings.enabled || !settings.on_assign || !emails.has(to)) return false;
  const m = compose(settings, 'assign', collection, rec, fromName);
  return once(workspaceId, `asg:${id}:${to}:${dateOf(collection, rec)}`, () => sendMail(to, m.subject, m.html, m.text));
}

/** Daily: "tomorrow" (or N days before) reminders for open, assigned items. */
export async function mailDueReminders(workspaceId: string) {
  if (!mailReady()) return { sent: 0 };
  const { settings, emails, ownerName } = await workspaceBits(workspaceId);
  if (!settings.enabled) return { sent: 0 };
  const target = addDaysIso(todayIL(), settings.days_before);
  const { data } = await sbAdmin().from('gd_records').select('id, collection, data').eq('workspace_id', workspaceId).in('collection', PLAN_COLLECTIONS as unknown as string[]);
  let sent = 0;
  for (const r of data ?? []) {
    const rec = r.data as any;
    const to = String(rec.assignee_email || '').toLowerCase();
    if (!to || rec.done || !emails.has(to) || dateOf(r.collection, rec) !== target) continue;
    try {
      const m = compose(settings, 'before', r.collection, rec, ownerName);
      if (await once(workspaceId, `rem:${r.id}:${target}`, () => sendMail(to, m.subject, m.html, m.text))) sent++;
    } catch (e) { console.error('reminder failed', r.id, e); }
    if (sent >= 40) break;
  }
  return { sent };
}

/** The owner tries a template on themselves. */
export async function mailTest(to: string, subject: string, body: string, fromName: string) {
  const s = mergeReminders({ assign_subject: subject, assign_body: body });
  const sample = { title: 'משימת ניסיון', due: addDaysIso(todayIL(), 1), time: '10:00', category: 'בית', assignee: fromName };
  const m = compose(s, 'assign', 'home_tasks', sample, fromName);
  await sendMail(to, m.subject, m.html, m.text);
}
