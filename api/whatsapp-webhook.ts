import crypto from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { env, handler, has, HttpError, recordsData, requireMember, sbAdmin } from './_lib/server.js';
import { geminiAgentReply } from './_lib/gemini.js';
import { ruleBasedReply } from '../shared/agent.js';

// Kapso → this endpoint (event: whatsapp.message.received). Docs: https://docs.kapso.ai/docs/platform/webhooks/overview
export const config = { api: { bodyParser: false } }; // raw body is needed for the signature

async function rawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

/** The webhook secret: KAPSO_WEBHOOK_SECRET if set, otherwise derived from the service-role key (never leaves the server). */
function webhookSecret() {
  if (has('KAPSO_WEBHOOK_SECRET')) return env('KAPSO_WEBHOOK_SECRET');
  if (!has('SUPABASE_SERVICE_ROLE_KEY')) return '';
  return crypto.createHmac('sha256', env('SUPABASE_SERVICE_ROLE_KEY')).update('gd-kapso-webhook-v1').digest('hex');
}

function verify(raw: Buffer, signature: string) {
  const secret = webhookSecret();
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(signature || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sendWhatsApp(to: string, body: string) {
  const r = await fetch(`https://api.kapso.ai/meta/whatsapp/${env('KAPSO_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { 'X-API-Key': env('KAPSO_API_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } }),
  });
  if (r.ok) console.log('wa: reply sent');
  if (!r.ok) console.error('Kapso send failed', r.status, (await r.text()).slice(0, 300));
}

const KAPSO_HOOKS = () => `https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/${env('KAPSO_PHONE_NUMBER_ID')}/webhooks`;
// Previews sit behind Vercel Deployment Protection; Kapso gets through with the automation bypass secret (if the owner enabled it).
const hookUrl = (req: VercelRequest) => {
  const base = `https://${req.headers['x-forwarded-host'] || req.headers.host}`.replace(/\/$/, '');
  const bypass = env('VERCEL_AUTOMATION_BYPASS_SECRET');
  return `${base}/api/whatsapp-webhook${bypass ? `?x-vercel-protection-bypass=${encodeURIComponent(bypass)}` : ''}`;
};

async function kapso(url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { 'X-API-Key': env('KAPSO_API_KEY'), 'content-type': 'application/json', ...(init.headers || {}) } });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Kapso', r.status, JSON.stringify(j).slice(0, 300)); throw new HttpError(502, `Kapso החזיר שגיאה (${r.status})`); }
  return j;
}

/** Owner-only: GET ?action=setup shows whether our webhook is registered in Kapso; POST ?action=setup registers it. */
async function setup(req: VercelRequest, res: any) {
  const me = await requireMember(req);
  if (me.role !== 'owner') throw new HttpError(403, 'רק הבעלים');
  if (!has('KAPSO_API_KEY', 'KAPSO_PHONE_NUMBER_ID')) throw new HttpError(503, 'Kapso לא מוגדר');
  const url = hookUrl(req);
  const list = await kapso(KAPSO_HOOKS());
  const hooks: any[] = list.data ?? list.whatsapp_webhooks ?? (Array.isArray(list) ? list : []);
  const urlOf = (h: any) => String(h.url ?? h.attributes?.url ?? '');
  const mine = hooks.find((h) => urlOf(h) === url);
  if (req.method === 'POST' && !mine) {
    // Replace an older registration of this same endpoint (e.g. without the bypass parameter).
    for (const h of hooks.filter((h) => urlOf(h).split('?')[0] === url.split('?')[0])) {
      await fetch(`${KAPSO_HOOKS()}/${h.id}`, { method: 'DELETE', headers: { 'X-API-Key': env('KAPSO_API_KEY') } }).catch(() => null);
    }
    await kapso(KAPSO_HOOKS(), { method: 'POST', body: JSON.stringify({ whatsapp_webhook: { url, events: ['whatsapp.message.received'], secret_key: webhookSecret(), active: true } }) });
    res.json({ registered: true, created: true, url: url.split('?')[0] });
    return;
  }
  res.json({ registered: !!mine, url: url.split('?')[0], bypass: has('VERCEL_AUTOMATION_BYPASS_SECRET') });
}

/** Last few WhatsApp turns, oldest first, so the agent can follow a conversation ("כן", "תוסיף גם…"). */
async function recentHistory(wsId: string, phone: string) {
  const { data } = await sbAdmin().from('gd_records').select('data').eq('workspace_id', wsId).eq('collection', 'wa_messages').order('created_at', { ascending: false }).limit(12);
  return (data ?? []).map((r) => r.data as any)
    .filter((d) => d.from === phone || d.to === phone)
    .slice(0, 8).reverse()
    .map((d) => ({ role: d.direction === 'in' ? 'user' as const : 'model' as const, text: String(d.text || '') }));
}

/** Signed-in members: the in-app chat talks to the same Gemini agent (POST ?action=chat {text, history}). */
async function chat(req: VercelRequest, res: any) {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const me = await requireMember(req);
  const body = JSON.parse((await rawBody(req)).toString('utf8') || '{}');
  const text = String(body.text || '').slice(0, 2000);
  if (!text) throw new HttpError(400, 'הודעה ריקה');
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8).map((h: any) => ({ role: h.role === 'model' ? 'model' as const : 'user' as const, text: String(h.text || '').slice(0, 2000) }));
  const db = recordsData(me.workspaceId);
  let reply: string;
  try { reply = has('GEMINI_API_KEY') ? await geminiAgentReply(text, db, history) : await ruleBasedReply(text, db); }
  catch (e) { console.error(e); reply = await ruleBasedReply(text, db).catch(() => 'משהו השתבש, נסה שוב בעוד רגע.'); }
  res.json({ reply, ai: has('GEMINI_API_KEY') });
}

export default handler(async (req, res) => {
  if (req.query?.action === 'setup') return setup(req, res);
  if (req.query?.action === 'chat') return chat(req, res);
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  if (!has('KAPSO_API_KEY', 'KAPSO_PHONE_NUMBER_ID') || !webhookSecret()) throw new HttpError(503, 'Kapso לא מוגדר');

  const raw = await rawBody(req);
  if (!verify(raw, String(req.headers['x-webhook-signature'] || ''))) throw new HttpError(401, 'חתימה לא תקינה');
  if (req.headers['x-webhook-event'] !== 'whatsapp.message.received') { console.log('wa: ignored event', req.headers['x-webhook-event']); res.json({ ok: true, ignored: true }); return; }

  const payload = JSON.parse(raw.toString('utf8'));
  const events: any[] = payload.batch ? payload.data : [payload];
  const allowed = env('WHATSAPP_ALLOWED_NUMBERS').split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean);

  // Single-owner setup: the agent works on the first (owner's) workspace.
  const sb = sbAdmin();
  const { data: ws } = await sb.from('gd_workspaces').select('id').order('created_at').limit(1).single();
  if (!ws) throw new HttpError(503, 'אין סביבת עבודה');
  const db = recordsData(ws.id);

  for (const ev of events) {
    const msg = ev.message ?? {};
    const from = String(msg.from || ev.conversation?.phone_number || '').replace(/\D/g, '');
    if (!from || !allowed.includes(from)) { console.log('wa: sender not allowed', from.slice(-4), 'keys', Object.keys(ev).join(','), 'msgkeys', Object.keys(msg).join(',')); continue; } // unknown senders are silently ignored
    if (msg.kapso?.direction && msg.kapso.direction !== 'inbound') continue;

    // idempotency: Kapso may retry deliveries
    const logId = `wa-${msg.id}`;
    const { error: dup } = await sb.from('gd_records').insert({ id: logId, workspace_id: ws.id, collection: 'wa_messages', data: { direction: 'in', text: msg.text?.body ?? `[${msg.type}]`, at: new Date().toISOString(), from } });
    if (dup) { console.log('wa: log insert failed / duplicate', dup.message); continue; }

    const history = await recentHistory(ws.id, from).catch(() => []);
    let reply: string;
    if (msg.type !== 'text' || !msg.text?.body) {
      reply = 'כרגע אני מבין רק הודעות טקסט. סריקת קבלות מתמונה תתווסף בקרוב.';
    } else {
      try { reply = has('GEMINI_API_KEY') ? await geminiAgentReply(msg.text.body, db, history.slice(0, -1)) : await ruleBasedReply(msg.text.body, db); }
      catch (e) { console.error(e); reply = await ruleBasedReply(msg.text.body, db).catch(() => 'משהו השתבש, נסה שוב בעוד רגע.'); }
    }
    await sendWhatsApp(from, reply);
    await sb.from('gd_records').insert({ id: `${logId}-r`, workspace_id: ws.id, collection: 'wa_messages', data: { direction: 'out', text: reply, at: new Date().toISOString(), to: from } });
  }
  res.json({ ok: true });
});
