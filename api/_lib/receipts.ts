import crypto from 'node:crypto';
import sharp from 'sharp';
import { env, sbAdmin } from './server.js';
import { scanReceipt, scanReceiptText } from './gemini.js';
import type { AgentData, Row } from '../../shared/agent.js';

// WhatsApp receipt flow: photo / PDF / link → a light copy is stored → Gemini reads it (supplier, date, totals, VAT,
// line items, category, suggested destination) → the agent asks where it belongs → the expense is saved with the copy.
// The pending receipt waits in gd_records (collection 'wa_pending', one per sender) until the owner answers.

export type Receipt = {
  merchant: string | null; total: number | null; vat: number | null; date: string | null; category: string | null;
  invoice_number: string | null; payment_method?: string | null; items?: { name: string; qty?: number | null; price?: number | null }[];
  suggested_target?: string | null; file_path?: string | null; source_url?: string | null;
};
type Target = { label: string; kind: 'home' | 'business' | 'property'; id?: string; name?: string };

const KAPSO = 'https://api.kapso.ai/meta/whatsapp/v24.0';
const BUCKET = 'gd-receipts';
const HOME_CATS = ['סופר ומזון', 'דיור ומשכנתא', 'חשמל מים וגז', 'תחבורה ורכב', 'ילדים וחינוך', 'בריאות', 'בילויים ומסעדות', 'ביגוד', 'תקשורת ומנויים', 'ביטוחים', 'חיסכון והשקעה', 'שונות'];
const BIZ_CATS = ['שכר', 'שכירות', 'שיווק ופרסום', 'תוכנות', 'חומרים ומלאי', 'רכב', 'מקצועי (רו״ח/עו״ד)', 'אחר'];
const ils = (n: number) => '₪' + (Math.round(n * 100) / 100).toLocaleString('he-IL');
const today = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);

const DAY = 86400e3;
/**
 * Receipt dates come back from Gemini as YYYY-MM-DD, but Israeli receipts print DD/MM/YY, so "19/11/26" is sometimes
 * read as 2019-11-26. A receipt is almost always from the last few months: if the date is far off, try the other
 * readings of the same digits (day↔year, day↔month) and keep the one closest to today; otherwise use today.
 */
export function normalizeReceiptDate(raw: string | null | undefined, now = today()): string {
  const m = String(raw || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return now;
  const t0 = Date.parse(now + 'T00:00:00Z');
  const ok = (y: number, mo: number, d: number) => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const t = Date.parse(iso + 'T00:00:00Z');
    if (Number.isNaN(t) || new Date(t).getUTCDate() !== d) return null;
    return { iso, diff: Math.abs(t - t0), plausible: t <= t0 + 3 * DAY && t >= t0 - 400 * DAY };
  };
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), yy = y % 100;
  const first = ok(y, mo, d);
  if (first?.plausible) return first.iso;
  const options = [ok(2000 + d, mo, yy), ok(y, d, mo), ok(2000 + d, yy, mo), ok(2000 + mo, d, yy)]
    .filter((x): x is NonNullable<typeof x> => !!x && x.plausible).sort((a, b) => a.diff - b.diff);
  return options[0]?.iso ?? now;
}

/** Download an incoming WhatsApp media file (image / PDF) through Kapso. */
export async function downloadMedia(mediaId: string): Promise<{ buf: Buffer; mime: string }> {
  const meta = await fetch(`${KAPSO}/${mediaId}?phone_number_id=${env('KAPSO_PHONE_NUMBER_ID')}`, { headers: { 'X-API-Key': env('KAPSO_API_KEY') }, signal: AbortSignal.timeout(8000) });
  if (!meta.ok) throw new Error(`Kapso media ${meta.status}`);
  const m: any = await meta.json();
  const r = await fetch(m.download_url || m.url, { headers: m.download_url ? {} : { 'X-API-Key': env('KAPSO_API_KEY') }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Kapso download ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), mime: (m.mime_type || r.headers.get('content-type') || 'image/jpeg').split(';')[0] };
}

/** Keep a light copy: images → WebP, max 1400px, ~q60 (usually 80–200KB). PDFs are kept as they are. */
async function storeCopy(workspaceId: string, buf: Buffer, mime: string): Promise<string | null> {
  try {
    const sb = sbAdmin();
    await sb.storage.createBucket(BUCKET, { public: false }).catch(() => null); // no-op if it exists
    let body = buf, type = mime, ext = mime === 'application/pdf' ? 'pdf' : 'bin';
    if (mime.startsWith('image/')) {
      body = await sharp(buf).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 60 }).toBuffer();
      type = 'image/webp'; ext = 'webp';
    }
    const path = `${workspaceId}/${today().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, body, { contentType: type, upsert: false });
    if (error) { console.error('receipt copy', error.message); return null; }
    return path;
  } catch (e) { console.error('receipt copy', (e as Error).message); return null; }
}

export async function targets(db: AgentData): Promise<Target[]> {
  const out: Target[] = [{ label: 'בית', kind: 'home' }];
  for (const b of (await db.all('businesses')) as Row[]) out.push({ label: String(b.name), kind: 'business', id: b.id, name: String(b.name) });
  for (const p of (await db.all('properties')) as Row[]) out.push({ label: `נכס · ${p.name}`, kind: 'property', id: p.id, name: String(p.name) });
  return out;
}

/** Read a receipt from a file (photo / PDF) or a link, keep a copy, return the parsed receipt. */
export async function ingest(db: AgentData, workspaceId: string, src: { buf: Buffer; mime: string } | { url: string }): Promise<Receipt> {
  const ts = (await targets(db)).map((t) => t.label);
  const cats = [...HOME_CATS, ...BIZ_CATS];
  let file: { buf: Buffer; mime: string } | null = 'buf' in src ? src : null;
  let pageText = '';
  if ('url' in src) {
    const r = await fetch(src.url, { redirect: 'follow', signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'Mozilla/5.0 (receipt-reader)' } });
    if (!r.ok) throw new Error(`link ${r.status}`);
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (type.startsWith('image/') || type === 'application/pdf') file = { buf: Buffer.from(await r.arrayBuffer()), mime: type };
    else pageText = (await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').slice(0, 20000);
  }
  if (file && file.buf.length > 15e6) throw new Error('file too large');
  // Phone photos are often 3–5MB; Gemini reads a 1600px JPEG just as well and much faster.
  let forAi = file;
  if (file?.mime.startsWith('image/')) {
    forAi = await sharp(file.buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
      .then((buf) => ({ buf, mime: 'image/jpeg' })).catch(() => file);
  }
  const [parsed, path] = await Promise.all([
    forAi ? scanReceipt(forAi.buf.toString('base64'), forAi.mime, ts, cats) : scanReceiptText(pageText, ts, cats),
    file ? storeCopy(workspaceId, file.buf, file.mime) : Promise.resolve(null),
  ]);
  return { ...parsed, date: normalizeReceiptDate(parsed?.date), file_path: path, source_url: 'url' in src ? src.url : null };
}

export function summary(r: Receipt) {
  const lines = [`${r.merchant || 'ספק לא מזוהה'}${r.date ? ` · ${r.date.split('-').reverse().join('/')}` : ''}`];
  if (r.total != null) lines.push(`סה״כ ${ils(r.total)}${r.vat ? ` (מע״מ ${ils(r.vat)})` : ''}`);
  const items = (r.items ?? []).slice(0, 6).map((i) => `• ${i.name}${i.qty && i.qty !== 1 ? ` ×${i.qty}` : ''}${i.price != null ? ` · ${ils(i.price)}` : ''}`);
  if (items.length) lines.push(...items, ...((r.items?.length ?? 0) > 6 ? [`ועוד ${r.items!.length - 6} פריטים`] : []));
  if (r.category) lines.push(`קטגוריה: ${r.category}`);
  return lines.join('\n');
}

export function question(r: Receipt, ts: Target[]) {
  const sug = ts.findIndex((t) => r.suggested_target && t.label === r.suggested_target);
  return `קיבלתי קבלה 🧾\n${summary(r)}\n\n${sug >= 0 ? `נראה לי שזה ל*${ts[sug].label}* — לענות "כן" כדי לאשר, או לבחור אחר:` : 'לאן לשייך?'}\n${ts.map((t, i) => `${i + 1}. ${t.label}`).join('\n')}\n\nאפשר לענות במספר או בשם. לביטול: "בטל".`;
}

/** The answer to "where does it belong?" → a target, or null if it doesn't look like one. */
export function pickTarget(text: string, ts: Target[], r: Receipt): Target | null {
  const t = text.trim().replace(/[׳'"״.!]/g, '');
  if (/^(כן|אישור|נכון|ok|yes|👍)$/i.test(t) && r.suggested_target) return ts.find((x) => x.label === r.suggested_target) ?? null;
  const n = Number(t.match(/^\d+/)?.[0]);
  if (n >= 1 && n <= ts.length) return ts[n - 1];
  const low = t.toLowerCase();
  if (!low) return null;
  return ts.find((x) => { const k = String(x.name ?? x.label).toLowerCase(); return low.includes(k) || k.includes(low); }) ?? (/בית/.test(t) ? ts[0] : null);
}

export async function saveExpense(db: AgentData, r: Receipt, t: Target): Promise<string> {
  const title = r.merchant || 'קבלה מוואטסאפ';
  const date = normalizeReceiptDate(r.date);
  const total = Number(r.total || 0);
  const common = { receipt_path: r.file_path ?? null, receipt_url: r.source_url ?? null, items: r.items ?? [], invoice_number: r.invoice_number ?? '', source: 'whatsapp-receipt' };
  if (t.kind === 'business') {
    const vat = r.vat != null ? Number(r.vat) : 0;
    const category = BIZ_CATS.includes(String(r.category)) ? r.category : 'אחר';
    await db.add('biz_expenses', { business_id: t.id, title, supplier: r.merchant ?? '', amount_net: Math.round((total - vat) * 100) / 100, vat, amount_gross: total, category, date, ...common });
    return `נרשם ✅ ${t.name}: ${title} · ${ils(total - vat)} לפני מע״מ · ${category} · ${date.split('-').reverse().join('/')}`;
  }
  const category = HOME_CATS.includes(String(r.category)) ? r.category : t.kind === 'property' ? 'דיור ומשכנתא' : 'שונות';
  await db.add('transactions', { title, amount: total, kind: 'הוצאה', category, date, method: r.payment_method || 'אשראי', ...common, ...(t.kind === 'property' ? { property_id: t.id, note: `נכס: ${t.name}` } : {}) });
  return `נרשם ✅ ${t.kind === 'property' ? t.name : 'בית'}: ${title} · ${ils(total)} · ${category} · ${date.split('-').reverse().join('/')}`;
}
