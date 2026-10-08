// Gmail import (stage 4): find invoices, receipts, payment confirmations and statements in the
// signed-in user's mailbox and turn each message into ONE import candidate (never a transaction).
// Discover (searchQuery + listMessages) → Extract (getMessage + messageParts + getAttachment) →
// Classify (extractFromMessage). Review and import happen in the app (import_candidates).
// Read-only scope. Pure helpers + Gmail REST calls with an injectable `fetchImpl`. Nothing here
// logs or throws tokens, raw Google responses or message contents: errors are GoogleError codes.
'use strict';

const gcal = require('./gcal');
const S = require('./statement');

const { GoogleError, SCOPE_GMAIL, TZ } = gcal;
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const DAY_MS = 86400000;
const MAX_PAGE = 100;

// ---------- Discover ----------

// What a receipt-like message says, Hebrew and English. Quoted phrases are exact; the braces
// make the whole list one OR group (Gmail syntax). Attachment names count too.
const TERMS = [
  'חשבונית', 'קבלה', '"חשבונית מס"', '"חשבונית מס קבלה"', '"אישור תשלום"', '"אישור חיוב"', '"דף חשבון"', '"פירוט חיובים"',
  'invoice', 'receipt', '"tax invoice"', '"payment confirmation"', '"payment received"', '"payment receipt"',
  '"billing statement"', '"your statement"', '"order receipt"',
  'filename:invoice', 'filename:receipt', 'filename:חשבונית', 'filename:קבלה',
];

// The search syntax has a practical length limit and a single giant query tends
// to miss results. Keep complementary searches small and merge their ids in the
// server. The final search deliberately includes generic PDF attachments: their
// *contents* are classified below, so a filename such as document.pdf is not
// silently excluded.
const SEARCH_GROUPS = [
  ['חשבונית', 'קבלה', '"חשבונית מס"', '"חשבונית מס קבלה"', '"אישור תשלום"', '"אישור חיוב"', '"אסמכתא"', '"פירוט חיובים"'],
  ['invoice', 'receipt', '"tax invoice"', '"payment confirmation"', '"payment received"', '"payment receipt"', '"billing statement"', '"credit note"'],
  ['filename:invoice', 'filename:receipt', 'filename:חשבונית', 'filename:קבלה', 'filename:pdf'],
];

// A Gmail search for receipt-like mail newer than `since` (Date | ISO | epoch ms). Chats and
// social mail are left out; spam and trash are never searched by the API anyway.
function searchQuery({ since } = {}) {
  const ms = since === undefined || since === null ? Date.now() - 90 * DAY_MS : new Date(since).getTime();
  if (!Number.isFinite(ms)) throw new TypeError('searchQuery: bad since');
  const after = Math.max(0, Math.floor(ms / 1000));
  return `after:${after} -in:chats -category:social {${TERMS.join(' ')}}`;
}

function searchQueries({ since } = {}) {
  const ms = since === undefined || since === null ? Date.now() - 90 * DAY_MS : new Date(since).getTime();
  if (!Number.isFinite(ms)) throw new TypeError('searchQueries: bad since');
  const after = Math.max(0, Math.floor(ms / 1000));
  return [
    ...SEARCH_GROUPS.map(group => `after:${after} -in:chats -category:social {${group.join(' ')}}`),
    `after:${after} -in:chats -category:social has:attachment filename:pdf`,
  ];
}

async function apiError(res) {
  const body = await res.json().catch(() => null);
  const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status;
  return new GoogleError(typeof reason === 'string' && /^[A-Za-z_]{1,40}$/.test(reason) ? reason : `http_${res.status}`, res.status);
}

async function apiGet(url, accessToken, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  if (!res.ok) throw await apiError(res);
  return res.json();
}

// The mailbox address (for a connection that has Gmail but no calendar scope)
async function getProfile(accessToken, { fetchImpl = fetch } = {}) {
  const b = await apiGet(`${API}/profile`, accessToken, fetchImpl);
  return { email: typeof b?.emailAddress === 'string' ? b.emailAddress : null };
}

// Message ids matching `q`, newest first, at most `max` → [{ id, threadId }]
async function listMessages(accessToken, q, { max = 50, fetchImpl = fetch } = {}) {
  const out = [];
  let pageToken = null;
  do {
    const u = new URL(`${API}/messages`);
    u.searchParams.set('q', q);
    u.searchParams.set('maxResults', String(Math.min(MAX_PAGE, max - out.length)));
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const b = await apiGet(u, accessToken, fetchImpl);
    for (const m of b?.messages ?? []) {
      if (typeof m?.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(m.id)) out.push({ id: m.id, threadId: m.threadId ?? null });
      if (out.length >= max) break;
    }
    pageToken = typeof b?.nextPageToken === 'string' ? b.nextPageToken : null;
  } while (pageToken && out.length < max);
  return out;
}

const safeId = id => {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(id)) throw new GoogleError('bad_id');
  return encodeURIComponent(id);
};

async function getMessage(accessToken, id, { fetchImpl = fetch } = {}) {
  return apiGet(`${API}/messages/${safeId(id)}?format=full`, accessToken, fetchImpl);
}

// An attachment's bytes
async function getAttachment(accessToken, messageId, attachmentId, { fetchImpl = fetch } = {}) {
  const b = await apiGet(`${API}/messages/${safeId(messageId)}/attachments/${safeId(attachmentId)}`, accessToken, fetchImpl);
  return b64url(b?.data);
}

// ---------- Extract ----------

function b64url(data) {
  if (typeof data !== 'string' || !data) return Buffer.alloc(0);
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

const header = (headers, name) => {
  const h = (headers ?? []).find(x => String(x?.name).toLowerCase() === name.toLowerCase());
  return typeof h?.value === 'string' ? h.value : null;
};

function decodeBody(buf, contentType) {
  if (!buf.length) return '';
  const cs = /charset\s*=\s*"?([\w.-]+)"?/i.exec(contentType ?? '')?.[1]?.toLowerCase();
  if (cs && !/^(utf-?8|us-ascii)$/.test(cs)) {
    try { return new TextDecoder(cs).decode(buf); } catch { /* unknown label: guess below */ }
  }
  return S.decodeText(buf);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '' };

// HTML → readable lines: scripts/styles dropped, block tags become line breaks, entities decoded
function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/[ \t ]+/g, ' ')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

// "Shop Ltd <billing@shop.example>" → { name, address, domain }
function parseFrom(from) {
  const s = String(from ?? '').trim();
  const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(s);
  const address = (m ? m[2] : s).trim().toLowerCase();
  let name = m ? m[1].trim().replace(/^"(.*)"$/, '$1').trim() : '';
  if (name.includes('@')) name = '';
  const domain = /@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(address)?.[1] ?? null;
  return { name: name || null, address: address.includes('@') ? address : null, domain };
}

// The local (Israel) calendar date of an instant
const localDate = ms => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms));

// A Gmail message (format=full) → { id, subject, from, date, text, attachments }. `text` is the
// first text/plain part, else the first text/html part as plain text. Attachments are listed,
// not downloaded (inline small ones carry `data`).
function messageParts(msg) {
  const payload = msg?.payload ?? {};
  let plain = null, html = null;
  const attachments = [];
  const walk = (p, depth) => {
    if (!p || depth > 12) return;
    const mime = String(p.mimeType ?? '').toLowerCase();
    const filename = typeof p.filename === 'string' ? p.filename : '';
    const body = p.body ?? {};
    if (filename || body.attachmentId) {
      attachments.push({
        filename: filename || null, mimeType: mime || null, attachmentId: body.attachmentId ?? null,
        size: Number.isFinite(body.size) ? body.size : null, ...(body.data ? { data: body.data } : {}),
      });
    } else if (mime === 'text/plain' && plain === null && body.data) {
      plain = decodeBody(b64url(body.data), header(p.headers, 'Content-Type'));
    } else if (mime === 'text/html' && html === null && body.data) {
      html = decodeBody(b64url(body.data), header(p.headers, 'Content-Type'));
    }
    for (const c of p.parts ?? []) walk(c, depth + 1);
  };
  walk(payload, 0);
  const internal = Number(msg?.internalDate);
  const hdrDate = Date.parse(header(payload.headers, 'Date') ?? '');
  const ms = Number.isFinite(internal) && internal > 0 ? internal : hdrDate;
  const text = plain !== null && plain.trim() ? plain.replace(/\r\n/g, '\n').trim() : html !== null ? htmlToText(html) : '';
  return {
    id: typeof msg?.id === 'string' ? msg.id : null,
    subject: header(payload.headers, 'Subject'),
    from: header(payload.headers, 'From'),
    date: Number.isFinite(ms) ? localDate(ms) : null,
    text,
    attachments,
  };
}

const isPdf = a => a?.mimeType === 'application/pdf' || /\.pdf$/i.test(a?.filename ?? '');

// ---------- Classify ----------

const hasInfo = r => r.total !== null || r.document_number !== null;
const POSITIVE = /(?:חשבונית|קבלה|אישור\s+(?:תשלום|חיוב|עסקה)|אסמכתא|זיכוי|invoice|receipt|billing|payment\s+(?:confirmation|receipt|successful|processed)|credit\s+(?:note|memo))/i;
const NEGATIVE = /(?:הצעת\s+מחיר|proforma|quotation|quote|payment\s+request|payment\s+reminder|תזכורת\s+לתשלום|shipping\s+confirmation|אישור\s+משלוח|newsletter|ניוזלטר|failed\s+payment|ניסיון\s+חיוב\s+נכשל)/i;
const CREDIT = /(?:זיכוי|credit\s+(?:note|memo)|refund)/i;

// Explainable, deterministic classification. This is intentionally not an AI
// decision: the result only controls discovery/review, never posts a finance
// transaction. A document with a generic name can score highly from its parsed
// PDF fields; a marketing/pro-forma message is rejected even if it says invoice.
function classifyMessage(parts, attachmentTexts = []) {
  const names = (parts?.attachments ?? []).map(a => a?.filename ?? '').join(' ');
  const text = [parts?.subject ?? '', parts?.text ?? '', names, ...(attachmentTexts ?? [])].join('\n');
  const parsed = extractFromMessage(parts, attachmentTexts);
  const reasons = [];
  let score = 0;
  if (POSITIVE.test(text)) { score += 25; reasons.push('מונח חשבונאי'); }
  // A generic PDF is worth manual review even when its name and extracted text
  // reveal nothing (it may be a scanned invoice). It is never auto-imported.
  if ((parts?.attachments ?? []).some(isPdf)) { score += 25; reasons.push('קובץ PDF'); }
  if (parsed.amount !== null) { score += 25; reasons.push('סכום מזוהה'); }
  if (parsed.document_number) { score += 15; reasons.push('מספר מסמך'); }
  if (parsed.occurred_on) { score += 8; reasons.push('תאריך'); }
  if (parsed.vat_amount !== null) { score += 7; reasons.push('מע״מ'); }
  if (NEGATIVE.test(text)) { score -= 70; reasons.push('סוג מסמך לא מתאים'); }
  score = Math.max(0, Math.min(100, score));
  const rejected = NEGATIVE.test(text) || score < 25;
  const confidence = score >= 70 ? 'high' : score >= 40 ? 'medium' : score >= 25 ? 'low' : 'none';
  return { score, confidence, rejected, document_type: CREDIT.test(text) ? 'credit' : POSITIVE.test(text) ? 'receipt_or_invoice' : 'unknown', reasons, parsed };
}

// One message → a candidate row. Amounts, VAT and document numbers come only from what the
// attachment (first) or the body states; nothing is guessed. The merchant is the supplier the
// attachment names, else the sender's display name, else the sender's domain. occurred_on is
// the document's date, else the day the e-mail arrived. A message with nothing recognised still
// gives a row (amount null): the review screen marks it unrecognised and the user decides.
function extractFromMessage({ subject = null, from = null, date = null, text = '' } = {}, attachmentTexts = []) {
  const atts = (attachmentTexts ?? []).filter(t => typeof t === 'string' && t.trim()).map(t => S.parseReceiptText(t));
  const att = atts.find(r => r.total !== null) ?? atts.find(hasInfo) ?? null;
  const body = text && String(text).trim() ? S.parseReceiptText(text) : null;
  const src = att && att.total !== null ? att : body && body.total !== null ? body : att ?? (body && hasInfo(body) ? body : null);
  const sender = parseFrom(from);
  const amount = src?.total ?? null;
  const subj = subject ? String(subject).replace(/\s+/g, ' ').trim() : null;
  return {
    occurred_on: src?.date ?? date ?? null,
    amount,
    direction: 'expense',
    merchant: (att?.supplier ?? sender.name ?? sender.domain ?? null)?.slice(0, 120) ?? null,
    description: subj ? subj.slice(0, 200) : null,
    currency: src?.currency ?? null,
    vat_amount: src && src.total !== null ? src.vat ?? null : null,
    document_number: src?.document_number ?? att?.document_number ?? body?.document_number ?? null,
  };
}

module.exports = {
  SCOPE_GMAIL, searchQuery, searchQueries, getProfile, listMessages, getMessage, getAttachment,
  messageParts, extractFromMessage, classifyMessage, htmlToText, parseFrom, isPdf, b64url,
};
