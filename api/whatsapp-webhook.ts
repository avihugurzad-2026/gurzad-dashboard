import crypto from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { env, handler, has, HttpError, recordsData, sbAdmin } from './_lib/server';
import { geminiAgentReply } from './_lib/gemini';
import { ruleBasedReply } from '../shared/agent';

// Kapso → this endpoint (event: whatsapp.message.received). Docs: https://docs.kapso.ai/docs/platform/webhooks/overview
export const config = { api: { bodyParser: false } }; // raw body is needed for the signature

async function rawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

function verify(raw: Buffer, signature: string) {
  const expected = crypto.createHmac('sha256', env('KAPSO_WEBHOOK_SECRET')).update(raw).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(signature || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sendWhatsApp(to: string, body: string) {
  const r = await fetch(`https://api.kapso.ai/meta/whatsapp/${env('KAPSO_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { 'X-API-Key': env('KAPSO_API_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } }),
  });
  if (!r.ok) console.error('Kapso send failed', r.status, (await r.text()).slice(0, 300));
}

export default handler(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  if (!has('KAPSO_WEBHOOK_SECRET', 'KAPSO_API_KEY', 'KAPSO_PHONE_NUMBER_ID')) throw new HttpError(503, 'Kapso לא מוגדר');

  const raw = await rawBody(req);
  if (!verify(raw, String(req.headers['x-webhook-signature'] || ''))) throw new HttpError(401, 'חתימה לא תקינה');
  if (req.headers['x-webhook-event'] !== 'whatsapp.message.received') { res.json({ ok: true, ignored: true }); return; }

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
    if (!from || !allowed.includes(from)) continue; // unknown senders are silently ignored
    if (msg.kapso?.direction && msg.kapso.direction !== 'inbound') continue;

    // idempotency: Kapso may retry deliveries
    const logId = `wa-${msg.id}`;
    const { error: dup } = await sb.from('gd_records').insert({ id: logId, workspace_id: ws.id, collection: 'wa_messages', data: { direction: 'in', text: msg.text?.body ?? `[${msg.type}]`, at: new Date().toISOString(), from } });
    if (dup) continue;

    let reply: string;
    if (msg.type !== 'text' || !msg.text?.body) {
      reply = 'כרגע אני מבין רק הודעות טקסט. סריקת קבלות מתמונה תתווסף בקרוב.';
    } else {
      try { reply = has('GEMINI_API_KEY') ? await geminiAgentReply(msg.text.body, db) : await ruleBasedReply(msg.text.body, db); }
      catch (e) { console.error(e); reply = await ruleBasedReply(msg.text.body, db).catch(() => 'משהו השתבש, נסה שוב בעוד רגע.'); }
    }
    await sendWhatsApp(from, reply);
    await sb.from('gd_records').insert({ id: `${logId}-r`, workspace_id: ws.id, collection: 'wa_messages', data: { direction: 'out', text: reply, at: new Date().toISOString(), to: from } });
  }
  res.json({ ok: true });
});
