import crypto from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { env, handler, has, HttpError, recordsData, requireMember, sbAdmin } from './_lib/server.js';
import { waitUntil } from '@vercel/functions';
import { GeminiBusy, geminiAgentReply, whileBusy } from './_lib/gemini.js';
import { downloadMedia, ingest, pickTarget, question, saveExpense, targets, type Receipt } from './_lib/receipts.js';
import { ruleBasedReply } from '../shared/agent.js';

// Kapso → this endpoint (event: whatsapp.message.received). Docs: https://docs.kapso.ai/docs/platform/webhooks/overview
export const config = { api: { bodyParser: false } }; // raw body is needed for the signature
export const maxDuration = 60; // seconds; the background reply must finish inside this

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
  const r = await fetch(`https://api.kapso.ai/meta/whatsapp/v24.0/${env('KAPSO_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST', signal: AbortSignal.timeout(8000),
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
  catch (e) { console.error(e); reply = e instanceof GeminiBusy ? 'ה-AI עמוס כרגע ולא ביצעתי כלום. נסה שוב בעוד כמה דקות.' : 'משהו השתבש ולא ביצעתי את הבקשה. אפשר לנסח שוב?'; }
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

  // Answer Kapso right away (so it doesn't time out and resend), and do the real work in the background.
  res.json({ ok: true });
  waitUntil(processEvents(raw, String(req.headers['x-idempotency-key'] || '')).catch((e) => console.error('wa process', e)));
});

async function processEvents(raw: Buffer, idemKey: string) {
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
    const msgId = msg.id || msg.wamid || msg.kapso?.id || ev.id || idemKey || crypto.randomUUID();
    const logId = `wa-${msgId}`;
    console.log('wa: in', msg.type, 'id?', !!msg.id, 'keys', Object.keys(msg).join(','));
    const { error: dup } = await sb.from('gd_records').insert({ id: logId, workspace_id: ws.id, collection: 'wa_messages', data: { direction: 'in', text: msg.text?.body ?? `[${msg.type}]`, at: new Date().toISOString(), from } });
    if (dup) { console.log('wa: log insert failed / duplicate', dup.message); continue; }

    const history = await recentHistory(ws.id, from).catch(() => []);
    let reply: string;
    const pendingId = `wa-pending-${ws.id}-${from}`;
    const body: string = msg.text?.body ?? '';
    const link = body.match(/https?:\/\/\S+/)?.[0];
    const media = msg.type === 'image' ? msg.image : msg.type === 'document' ? msg.document : null;
    try {
      const { data: pend } = await sb.from('gd_records').select('data').eq('id', pendingId).maybeSingle();
      const pending = pend?.data as Receipt | undefined;
      if (media?.id || (link && /קבל|חשבונ|receipt|invoice|pdf|jpg|png/i.test(body + link)) || (link && body.trim() === link)) {
        // A new receipt: keep a copy, read it, ask where it belongs.
        if (media?.id) await sendWhatsApp(from, 'קיבלתי, קורא את הקבלה… ⏳');
        const src = media?.id ? await downloadMedia(media.id) : { url: link! };
        const r = await whileBusy(() => sendWhatsApp(from, 'ה-AI עמוס כרגע, ממשיך לנסות לקרוא את הקבלה ⏳'), () => ingest(db, ws.id, src));
        await sb.from('gd_records').upsert({ id: pendingId, workspace_id: ws.id, collection: 'wa_pending', data: r });
        reply = question(r, await targets(db));
      } else if (pending && body) {
        if (/^\s*(בטל|ביטול|cancel)\s*$/i.test(body)) { await sb.from('gd_records').delete().eq('id', pendingId); reply = 'בוטל, הקבלה לא נרשמה.'; }
        else {
          const ts = await targets(db);
          const t = pickTarget(body, ts, pending);
          if (t) { reply = await saveExpense(db, pending, t); await sb.from('gd_records').delete().eq('id', pendingId); }
          else reply = `לא הבנתי לאן לשייך. לענות במספר:\n${ts.map((x, i) => `${i + 1}. ${x.label}`).join('\n')}\nאו "בטל".`;
        }
      } else if (msg.type !== 'text' || !body) {
        reply = 'אני מבין טקסט, תמונות של קבלות, קבצי PDF וקישורים לקבלות.';
      } else {
        if (!has('GEMINI_API_KEY')) reply = await ruleBasedReply(body, db);
        else {
          try { reply = await whileBusy(() => sendWhatsApp(from, 'רגע, ה-AI עמוס כרגע. אני ממשיך לנסות ואענה ברגע שזה יעבור ⏳'), () => geminiAgentReply(body, db, history.slice(0, -1))); }
          catch (e) {
            console.error('wa gemini', e);
            reply = e instanceof GeminiBusy
              ? 'ה-AI לא זמין כבר כמה דקות, אז לא ביצעתי כלום כדי לא לטעות. כדאי לשלוח שוב בעוד כמה דקות.'
              : 'משהו השתבש ולא ביצעתי את הבקשה. אפשר לנסח שוב?';
          }
        }
      }
    } catch (e) {
      console.error('wa receipt', e);
      reply = e instanceof GeminiBusy ? 'ה-AI לא זמין כבר כמה דקות ולא הספקתי לקרוא את הקבלה. אפשר לשלוח אותה שוב בעוד כמה דקות.' : 'לא הצלחתי לקרוא את הקבלה. אפשר לשלוח תמונה ברורה יותר או קישור אחר.';
    }
    await sendWhatsApp(from, reply);
    await sb.from('gd_records').insert({ id: `${logId}-r`, workspace_id: ws.id, collection: 'wa_messages', data: { direction: 'out', text: reply, at: new Date().toISOString(), to: from } });
  }
}

