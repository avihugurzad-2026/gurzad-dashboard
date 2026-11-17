import webpush from 'web-push';
import { env, has, sbAdmin } from './server.js';
import { computeAlerts, DEFAULT_NOTIFY_PREFS, digest, wants, type Alert, type NotifyPrefs } from '../../shared/alerts.js';
import type { Row } from '../../shared/agent.js';

export const pushReady = () => has('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY');
let configured = false;
function setup() {
  if (configured) return;
  webpush.setVapidDetails(env('VAPID_SUBJECT') || env('APP_URL') || 'https://example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  configured = true;
}

export type PushMessage = { title: string; body: string; url: string; tag?: string; badge?: number };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string; fail_count: number };

/** Send one message to one device. Dead subscriptions (404/410) are removed. */
export async function sendPush(sub: Sub, msg: PushMessage): Promise<boolean> {
  setup();
  const sb = sbAdmin();
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(msg), { TTL: 60 * 60 * 12, urgency: 'normal' });
    await sb.from('gd_push_subscriptions').update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq('id', sub.id);
    return true;
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410 || sub.fail_count >= 5) await sb.from('gd_push_subscriptions').delete().eq('id', sub.id);
    else await sb.from('gd_push_subscriptions').update({ fail_count: sub.fail_count + 1 }).eq('id', sub.id);
    console.error('push failed', e?.statusCode, String(e?.body || e?.message || '').slice(0, 200));
    return false;
  }
}

const todayIL = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

async function loadWorkspace(workspaceId: string) {
  const sb = sbAdmin();
  const byCol: Record<string, Row[]> = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('gd_records').select('id, collection, data').eq('workspace_id', workspaceId).neq('collection', 'wa_messages').range(from, from + 999);
    if (error) throw error;
    (data ?? []).forEach((r) => (byCol[r.collection] ||= []).push({ ...(r.data as object), id: r.id }));
    if (!data || data.length < 1000) break;
  }
  return byCol;
}

/** Push to every device of a workspace. `pick` decides, per member, which alerts they get (areas + prefs). */
async function fanOut(workspaceId: string, build: (allowed: (a: Alert) => boolean) => PushMessage | null) {
  const sb = sbAdmin();
  const [{ data: subs }, { data: members }] = await Promise.all([
    sb.from('gd_push_subscriptions').select('id, user_id, endpoint, p256dh, auth, prefs, fail_count').eq('workspace_id', workspaceId),
    sb.from('gd_memberships').select('user_id, role, areas').eq('workspace_id', workspaceId),
  ]);
  let sent = 0;
  for (const s of subs ?? []) {
    const m = (members ?? []).find((x) => x.user_id === s.user_id);
    if (!m) continue; // membership was revoked
    const prefs: NotifyPrefs = { ...DEFAULT_NOTIFY_PREFS, ...(s.prefs as object) };
    const msg = build((a) => (m.role === 'owner' || (m.areas as string[]).includes(a.area)) && wants(a, prefs));
    if (msg && await sendPush(s as Sub, msg)) sent++;
  }
  return sent;
}

/** Daily run for one workspace: push what is new since the last run; urgent items are repeated every 3 days. */
export async function notifyWorkspace(workspaceId: string) {
  const sb = sbAdmin();
  const data = await loadWorkspace(workspaceId);
  const all = computeAlerts((c) => data[c] ?? [], { today: todayIL() });
  const { data: log } = await sb.from('gd_notify_log').select('alert_id, last_sent_at').eq('workspace_id', workspaceId);
  const seen = new Map((log ?? []).map((l) => [l.alert_id, new Date(l.last_sent_at).getTime()]));
  const fresh = all.filter((a) => !seen.has(a.id) || (a.level === 'danger' && Date.now() - seen.get(a.id)! > 3 * 864e5 - 36e5));

  // forget alerts that were resolved, so they notify again if they come back
  const gone = [...seen.keys()].filter((id) => !id.includes(':') && !all.some((a) => a.id === id)); // ids with ':' are email reminders
  if (gone.length) await sb.from('gd_notify_log').delete().eq('workspace_id', workspaceId).in('alert_id', gone);
  if (!fresh.length) return { alerts: all.length, fresh: 0, sent: 0 };

  const sent = await fanOut(workspaceId, (ok) => {
    const mine = fresh.filter(ok);
    const d = digest(mine);
    return d && { ...d, badge: all.filter(ok).length };
  });
  const now = new Date().toISOString();
  await sb.from('gd_notify_log').upsert(fresh.map((a) => ({ workspace_id: workspaceId, alert_id: a.id, level: a.level, last_sent_at: now })), { onConflict: 'workspace_id,alert_id' });
  return { alerts: all.length, fresh: fresh.length, sent };
}

/** Immediate push for an event (site down, WhatsApp agent action…) to members who can see that area. */
export async function notifyEvent(workspaceId: string, a: Alert) {
  if (!pushReady()) return 0;
  return fanOut(workspaceId, (ok) => (ok(a) ? { title: a.title, body: a.detail, url: a.to, tag: a.id } : null));
}
