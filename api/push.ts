import { handler, HttpError, requireMember, sbAdmin, env } from './_lib/server.js';
import { pushReady, sendPush } from './_lib/push.js';
import { DEFAULT_NOTIFY_PREFS } from '../shared/alerts.js';

const AREAS = ['home', 'business', 'invest'];
const cleanPrefs = (p: any) => ({
  areas: Array.isArray(p?.areas) ? p.areas.filter((a: string) => AREAS.includes(a)) : DEFAULT_NOTIFY_PREFS.areas,
  urgentOnly: !!p?.urgentOnly,
});
const okEndpoint = (e: string) => { try { const u = new URL(e); return u.protocol === 'https:' && e.length < 1000; } catch { return false; } };

// GET                                   → { ready, publicKey }  (public key only; safe to expose)
// POST   { subscription, prefs, device } → save / update this device
// POST   { endpoint, test: true }        → send a test notification to this device
// DELETE { endpoint }                    → remove this device
export default handler(async (req, res) => {
  if (req.method === 'GET') { res.json({ ready: pushReady(), publicKey: env('VAPID_PUBLIC_KEY') }); return; }
  const me = await requireMember(req);
  if (!pushReady()) throw new HttpError(503, 'התראות פוש לא מוגדרות בשרת');
  const sb = sbAdmin();
  const body = (req.body ?? {}) as any;

  if (req.method === 'DELETE') {
    await sb.from('gd_push_subscriptions').delete().eq('endpoint', String(body.endpoint || '')).eq('user_id', me.user.id);
    res.json({ ok: true });
    return;
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

  if (body.test) {
    const { data: sub } = await sb.from('gd_push_subscriptions').select('id, endpoint, p256dh, auth, fail_count').eq('endpoint', String(body.endpoint || '')).eq('user_id', me.user.id).maybeSingle();
    if (!sub) throw new HttpError(404, 'המכשיר הזה לא רשום להתראות');
    const ok = await sendPush(sub, { title: 'ההתראות פועלות', body: 'כך ייראו התראות מהדשבורד בטלפון שלך.', url: '/notifications', tag: 'test' });
    if (!ok) throw new HttpError(502, 'השליחה נכשלה. נסה להפעיל את ההתראות מחדש.');
    res.json({ ok: true });
    return;
  }

  const s = body.subscription;
  if (!s?.endpoint || !okEndpoint(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) throw new HttpError(400, 'רישום לא תקין');
  const { count } = await sb.from('gd_push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', me.user.id);
  if ((count ?? 0) >= 12) throw new HttpError(400, 'יותר מדי מכשירים רשומים');
  const { error } = await sb.from('gd_push_subscriptions').upsert({
    workspace_id: me.workspaceId, user_id: me.user.id, endpoint: s.endpoint, p256dh: String(s.keys.p256dh).slice(0, 200), auth: String(s.keys.auth).slice(0, 100),
    prefs: cleanPrefs(body.prefs), device: String(body.device || '').slice(0, 80), fail_count: 0,
  }, { onConflict: 'endpoint' });
  if (error) throw error;
  res.json({ ok: true });
});
