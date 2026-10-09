'use server';
import { dbDate } from '@/lib/period';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import type { PoolClient } from 'pg';
import { currentUser, type SessionUser } from '@/server/auth';
import { db } from '@/server/db';
import { ledgerAccess } from '@/server/ledger';
import { addCandidates, createImport, type ParsedRow } from '@/server/imports';
import { isIsoDate } from '@/lib/finance';
import S from '@domain/statement';
import L from '@domain/ledger';
import money from '@domain/money';

// Statement, receipt and link imports: Upload → Parse → Normalize → Duplicates → Categorize →
// Review → Import. Upload only creates candidates; commitImport / saveReceipt write transactions,
// after the user approved them. Imports are private to their owner until committed.

export type ImportResult = { ok: true; id?: string } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 4 * 1024 * 1024;
const NOT_READY = 'טבלאות הייבוא עוד לא נוצרו במסד';
const tableMissing = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string })?.code ?? '');
class Refuse extends Error {}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
const uuid = (f: FormData, k: string) => { const v = str(f, k); return v && UUID.test(v) ? v : null; };

async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
const log = (c: PoolClient, u: SessionUser, type: string, id: string, action: string, meta: Record<string, unknown> = {}) =>
  c.query(`INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, $2, $3, $4, $5)`, [u.id, type, id, action, JSON.stringify(meta)]);

async function storeFile(c: PoolClient, u: SessionUser, name: string, mime: string, buf: Buffer): Promise<string> {
  const { rows } = await c.query(
    `INSERT INTO files (name, mime, size_bytes, sha256, data, owner_user_id, scope) VALUES ($1, $2, $3, $4, $5, $6, 'user') RETURNING id`,
    [name.slice(0, 200) || 'קובץ', mime.slice(0, 100) || 'application/octet-stream', buf.length, createHash('sha256').update(buf).digest('hex'), buf, u.id]);
  return rows[0].id;
}

async function readUpload(f: FormData, key = 'file'): Promise<{ name: string; mime: string; buf: Buffer } | string> {
  const file = f.get(key);
  if (!(file instanceof File) || file.size === 0) return 'בחר קובץ';
  if (file.size > MAX) return 'הקובץ גדול מ-4MB';
  return { name: file.name || 'קובץ', mime: file.type || 'application/octet-stream', buf: Buffer.from(await file.arrayBuffer()) };
}

// Where the rows go by default: the chosen account's workspace, else the chosen workspace
async function target(u: SessionUser, f: FormData) {
  const a = await ledgerAccess(u, uuid(f, 'ws'));
  if (!a || !a.canWrite) return null;
  const account = uuid(f, 'account_id');
  if (account) {
    const { rows } = await db().query(`SELECT workspace_id FROM financial_accounts WHERE id = $1 AND deleted_at IS NULL`, [account]);
    const acc = rows[0] ? await ledgerAccess(u, rows[0].workspace_id) : null;
    if (!acc?.canWrite) return null;
    return { ws: L.defaultWorkspace(rows[0], a.w.id), account };
  }
  return { ws: a.w.id, account: null };
}

// ── Statement (CSV / Excel / PDF) ─────────────────────────────────────────────
export async function uploadStatement(_: ImportResult | null, f: FormData): Promise<ImportResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  const t = await target(u, f);
  if (!t) return fail('אין לך גישה לאזור הזה');
  const up = await readUpload(f);
  if (typeof up === 'string') return fail(up);
  const kind = str(f, 'kind');
  const parsed = S.parseStatement(up.buf, up.name, up.mime, { kind: kind === 'bank' || kind === 'card' ? kind : 'auto' });
  if (parsed.error) return fail(parsed.error);
  if (!parsed.rows.length) return fail(parsed.warnings[0] ?? 'לא נמצאו תנועות בקובץ. בדוק שזה דוח בנק או אשראי עם שורת כותרות.');
  let id: string;
  try {
    id = await inTx(async c => {
      const fileId = await storeFile(c, u, up.name, up.mime, up.buf);
      const imp = await createImport(c, u, { workspace_id: t.ws, account_id: t.account, source: 'statement', format: parsed.format, file_id: fileId, file_name: up.name });
      if (parsed.warnings.length) await c.query(`UPDATE statement_imports SET error = $2 WHERE id = $1`, [imp, parsed.warnings.join(' · ').slice(0, 500)]);
      const rows: ParsedRow[] = parsed.rows.map(r => ({
        occurred_on: r.occurred_on, amount: r.amount, direction: r.direction, merchant: r.merchant || null, description: r.description,
        currency: r.currency, reference: r.reference,
      }));
      await addCandidates(c, u, imp, t.ws, rows);
      await log(c, u, 'import', imp, 'upload', { source: 'statement', format: parsed.format, rows: rows.length });
      return imp;
    });
  } catch (e) {
    if (tableMissing(e)) return fail(NOT_READY);
    unstable_rethrow(e);
    console.error(e);
    return fail('לא נשמר, נסה שוב');
  }
  redirect(`/finance-import?import=${id}`);
}

// ── Receipt / invoice (file, camera, link) ────────────────────────────────────
function receiptRow(text: string, external?: string): ParsedRow {
  const r = S.parseReceiptText(text);
  return {
    occurred_on: r.date, amount: r.total, direction: r.total ? 'expense' : null, merchant: r.supplier, description: null,
    currency: r.currency, vat_amount: r.vat, document_number: r.document_number, external_id: external ?? null,
  };
}

export async function uploadReceipt(_: ImportResult | null, f: FormData): Promise<ImportResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  const t = await target(u, f);
  if (!t) return fail('אין לך גישה לאזור הזה');
  const up = await readUpload(f);
  if (typeof up === 'string') return fail(up);
  const isPdf = up.buf.subarray(0, 4).toString('latin1') === '%PDF';
  const isImage = /^image\/(jpeg|png|webp|heic|heif)$/.test(up.mime);
  if (!isPdf && !isImage) return fail('קבלה: PDF, JPG או PNG');
  const text = isPdf ? S.pdfText(up.buf) : '';
  let id: string;
  try {
    id = await inTx(async c => {
      const fileId = await storeFile(c, u, up.name, isPdf ? 'application/pdf' : up.mime, up.buf);
      const imp = await createImport(c, u, { workspace_id: t.ws, source: 'receipt', format: isPdf ? 'pdf' : 'image', file_id: fileId, file_name: up.name });
      const note = isImage ? 'זיהוי טקסט מתמונה (OCR) עוד לא זמין: מלא את הפרטים ידנית.' : !text ? 'לא נמצא טקסט ב-PDF (כנראה סרוק): מלא את הפרטים ידנית.' : null;
      if (note) await c.query(`UPDATE statement_imports SET error = $2 WHERE id = $1`, [imp, note]);
      await addCandidates(c, u, imp, t.ws, [text ? receiptRow(text) : { occurred_on: null, amount: null, direction: null, merchant: null }]);
      await log(c, u, 'import', imp, 'upload', { source: 'receipt', format: isPdf ? 'pdf' : 'image' });
      return imp;
    });
  } catch (e) {
    if (tableMissing(e)) return fail(NOT_READY);
    unstable_rethrow(e);
    console.error(e);
    return fail('לא נשמר, נסה שוב');
  }
  redirect(`/finance-import?import=${id}`);
}

// A public https link to a receipt (PDF or page). Private / local addresses are refused.
function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && privateAddress(v.slice(7));
}
async function fetchPublic(raw: string): Promise<{ buf: Buffer; type: string; name: string } | string> {
  let url: URL;
  try { url = new URL(raw); } catch { return 'קישור לא תקין'; }
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== 'https:') return 'רק קישורי https';
    if (url.username || url.password || (url.port && url.port !== '443')) return 'קישור לא נתמך';
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (!addrs.length) return 'הכתובת לא נמצאה';
    if (addrs.some(a => privateAddress(a.address))) return 'כתובת פנימית לא מותרת';
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/pdf,text/html;q=0.9,*/*;q=0.5' } }).catch(() => null);
    if (!res) return 'הקישור לא נטען';
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location')!, url); continue; }
    if (!res.ok) return `הקישור החזיר שגיאה (${res.status})`;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX) return 'הקובץ בקישור גדול מ-4MB';
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX) { await reader.cancel(); return 'הקובץ בקישור גדול מ-4MB'; }
      chunks.push(value);
    }
    return { buf: Buffer.concat(chunks), type: (res.headers.get('content-type') ?? '').split(';')[0].trim(), name: decodeURIComponent(url.pathname.split('/').pop() || url.hostname).slice(0, 200) };
  }
  return 'יותר מדי הפניות';
}
const htmlText = (s: string) => s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ');

export async function importReceiptUrl(_: ImportResult | null, f: FormData): Promise<ImportResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  const t = await target(u, f);
  if (!t) return fail('אין לך גישה לאזור הזה');
  const link = str(f, 'url');
  if (!link || link.length > 2000) return fail('הדבק קישור');
  const got = await fetchPublic(link);
  if (typeof got === 'string') return fail(got);
  const isPdf = got.buf.subarray(0, 4).toString('latin1') === '%PDF';
  const text = isPdf ? S.pdfText(got.buf) : /html|text/.test(got.type) ? htmlText(S.decodeText(got.buf)) : '';
  let id: string;
  try {
    id = await inTx(async c => {
      const fileId = isPdf ? await storeFile(c, u, got.name.endsWith('.pdf') ? got.name : `${got.name}.pdf`, 'application/pdf', got.buf) : null;
      const imp = await createImport(c, u, { workspace_id: t.ws, source: 'receipt', format: 'url', file_id: fileId, file_name: new URL(link).hostname });
      if (!text.trim()) await c.query(`UPDATE statement_imports SET error = $2 WHERE id = $1`, [imp, 'לא נמצא טקסט בקישור: מלא את הפרטים ידנית.']);
      await addCandidates(c, u, imp, t.ws, [text.trim() ? receiptRow(text) : { occurred_on: null, amount: null, direction: null, merchant: null }]);
      await log(c, u, 'import', imp, 'upload', { source: 'receipt', format: 'url' });
      return imp;
    });
  } catch (e) {
    if (tableMissing(e)) return fail(NOT_READY);
    unstable_rethrow(e);
    console.error(e);
    return fail('לא נשמר, נסה שוב');
  }
  redirect(`/finance-import?import=${id}`);
}

// ── Review → import ───────────────────────────────────────────────────────────
// Fields per candidate: inc_<id> (on = import), ws_<id>, cat_<id>, sub_<id>, fv_<id>, freq_<id>, rem_<id>,
// and for rows the user fixed by hand: date_<id>, amt_<id>, dir_<id>, merchant_<id>.
export async function commitImport(_: ImportResult | null, f: FormData): Promise<ImportResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  const importId = uuid(f, 'import');
  if (!importId) return fail('ייבוא לא תקין');
  const access = new Map<string, Awaited<ReturnType<typeof ledgerAccess>>>();
  const canWrite = async (ws: string) => {
    if (!access.has(ws)) access.set(ws, await ledgerAccess(u, ws));
    return access.get(ws)?.canWrite ? access.get(ws)! : null;
  };
  try {
    const n = await inTx(async c => {
      const { rows: [imp] } = await c.query(`SELECT id, status, account_id, workspace_id, source FROM statement_imports WHERE id = $1 AND owner_user_id = $2 FOR UPDATE`, [importId, u.id]);
      if (!imp) throw new Refuse('הייבוא לא נמצא');
      if (imp.status !== 'review') throw new Refuse('הייבוא הזה כבר טופל');
      const { rows: cands } = await c.query(`SELECT * FROM import_candidates WHERE import_id = $1 AND status NOT IN ('imported', 'skipped')`, [importId]);
      let count = 0;
      for (const k of cands) {
        if (str(f, `inc_${k.id}`) !== 'on') {
          await c.query(`UPDATE import_candidates SET status = 'skipped' WHERE id = $1`, [k.id]);
          continue;
        }
        const ws = uuid(f, `ws_${k.id}`) ?? k.target_workspace_id;
        const a = ws ? await canWrite(ws) : null;
        if (!a) throw new Refuse('אין לך גישה לאחד האזורים שנבחרו');
        const date = str(f, `date_${k.id}`) ?? (k.occurred_on ? dbDate(k.occurred_on) : null);
        if (!isIsoDate(date)) throw new Refuse(`חסר תאריך ב"${k.merchant ?? 'שורה'}"`);
        const amount = str(f, `amt_${k.id}`) ? money.parseAmount(str(f, `amt_${k.id}`)) : k.amount ? Number(k.amount) : null;
        if (!amount) throw new Refuse(`חסר סכום ב"${k.merchant ?? 'שורה'}"`);
        // Gmail candidates are receipt/invoice discoveries. They can only become
        // expenses; do not trust a forged client-side direction for this flow.
        const dir = imp.source === 'gmail' ? 'expense' : (str(f, `dir_${k.id}`) ?? k.direction);
        if (dir !== 'income' && dir !== 'expense') throw new Refuse(`בחר הכנסה או הוצאה ב"${k.merchant ?? 'שורה'}"`);
        const merchant = (str(f, `merchant_${k.id}`) ?? k.merchant)?.slice(0, 120) ?? null;
        const cat = uuid(f, `cat_${k.id}`), sub = uuid(f, `sub_${k.id}`);
        const fv = str(f, `fv_${k.id}`), freq = str(f, `freq_${k.id}`);
        const catRow = cat ? (await c.query(`SELECT id, key, kind FROM transaction_categories WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`, [cat, ws])).rows[0] : null;
        if (cat && !catRow) throw new Refuse('קטגוריה לא שייכת לאזור שנבחר');
        const subOk = sub ? (await c.query(`SELECT 1 FROM transaction_categories WHERE id = $1 AND workspace_id = $2 AND parent_id = $3`, [sub, ws, cat])).rowCount : 0;
        const account = imp.account_id && ws === imp.workspace_id ? imp.account_id : null;
        const domain = a.w.kind === 'personal' ? 'personal' : a.w.domain;
        const { rows: [tx] } = await c.query(
          `INSERT INTO transactions (direction, occurred_on, amount_gross, currency, merchant, counterparty_name, description, category, category_id, subcategory_id,
             account_id, fixed_or_variable, frequency, source, import_id, dedupe_key, vat_included, vat_amount, document_number,
             classification, domain, branch, owner_user_id, scope, created_by)
           VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'personal', $19, $20, $21, $22, $21) RETURNING id`,
          [dir, date, amount, k.currency ?? 'ILS', merchant, k.description, catRow?.key ?? 'other', catRow?.id ?? null, subOk ? sub : null, account,
            fv === 'fixed' || fv === 'variable' ? fv : null, freq && /^(one_time|monthly|bimonthly|quarterly|yearly|custom)$/.test(freq) ? freq : null,
            imp.source === 'gmail' ? 'gmail' : imp.source === 'receipt' ? 'receipt' : 'statement', importId, L.dedupeKey(date, amount, merchant ?? ''),
            !!k.vat_amount && Number(k.vat_amount) <= amount, k.vat_amount && Number(k.vat_amount) <= amount ? k.vat_amount : 0, k.document_number,
            domain, a.w.kind === 'personal' ? null : a.w.branch, u.id, a.w.kind === 'personal' ? 'user' : 'shared']);
        await c.query(`UPDATE import_candidates SET status = 'imported', imported_transaction_id = $2, target_workspace_id = $3 WHERE id = $1`, [k.id, tx.id, ws]);
        if (k.rule_id) await c.query(`UPDATE categorization_rules SET hits = hits + 1 WHERE id = $1 AND owner_user_id = $2`, [k.rule_id, u.id]);
        if (str(f, `rem_${k.id}`) === 'on' && merchant) {
          const pattern = L.normalizeMerchant(merchant);
          if (pattern.length >= 2) {
            const { rowCount } = await c.query(`UPDATE categorization_rules SET target_workspace_id = $3, category_id = $4, subcategory_id = $5, fixed_or_variable = $6,
              frequency = $7, active = true, updated_at = now() WHERE owner_user_id = $1 AND pattern = $2 AND deleted_at IS NULL`,
              [u.id, pattern, ws, catRow?.id ?? null, subOk ? sub : null, fv === 'fixed' || fv === 'variable' ? fv : null, freq || null]);
            if (!rowCount) await c.query(`INSERT INTO categorization_rules (owner_user_id, pattern, target_workspace_id, category_id, subcategory_id, fixed_or_variable, frequency)
              VALUES ($1, $2, $3, $4, $5, $6, $7)`, [u.id, pattern, ws, catRow?.id ?? null, subOk ? sub : null, fv === 'fixed' || fv === 'variable' ? fv : null, freq || null]);
          }
        }
        count++;
      }
      await c.query(`UPDATE statement_imports SET status = 'imported', imported_count = imported_count + $2, completed_at = now() WHERE id = $1`, [importId, count]);
      await log(c, u, 'import', importId, 'commit', { imported: count });
      return count;
    });
    revalidatePath('/personal', 'layout');
    revalidatePath('/household', 'layout');
    revalidatePath('/finance-import');
    return { ok: true, id: String(n) };
  } catch (e) {
    if (e instanceof Refuse) return fail(e.message);
    if (tableMissing(e)) return fail(NOT_READY);
    if ((e as { code?: string })?.code === '23514') return fail('אחד הערכים לא תקין');
    unstable_rethrow(e);
    console.error(e);
    return fail('לא נשמר, נסה שוב');
  }
}

export async function cancelImport(id: string): Promise<ImportResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  if (!UUID.test(id)) return fail('ייבוא לא תקין');
  const { rowCount } = await db().query(`UPDATE statement_imports SET status = 'cancelled', completed_at = now() WHERE id = $1 AND owner_user_id = $2 AND status = 'review'`, [id, u.id]);
  if (!rowCount) return fail('הייבוא לא נמצא');
  await db().query(`INSERT INTO activity_log (user_id, object_type, object_id, action) VALUES ($1, 'import', $2, 'cancel')`, [u.id, id]);
  revalidatePath('/finance-import');
  return { ok: true };
}

// One receipt: attach it to an existing transaction (match) or save a new expense, and keep the
// file as a document of the chosen workspace (אישי / משק הבית).
export async function saveReceipt(_: ImportResult | null, f: FormData): Promise<ImportResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  const importId = uuid(f, 'import');
  const candId = uuid(f, 'candidate');
  if (!importId || !candId) return fail('קבלה לא תקינה');
  const a = await ledgerAccess(u, uuid(f, 'ws'));
  if (!a || !a.canWrite) return fail('בחר לאן לשמור');
  const match = uuid(f, 'match');
  const date = str(f, 'occurred_on');
  if (!isIsoDate(date)) return fail('צריך תאריך');
  const amount = money.parseAmount(str(f, 'amount'));
  if (amount === null) return fail('צריך סכום');
  const merchant = str(f, 'merchant');
  if (!merchant || merchant.length > 120) return fail('כתוב שם ספק');
  const vatIn = str(f, 'vat_amount');
  // 0 is a real answer (an exempt dealer's receipt), so only a negative or too-large VAT is refused
  const vat = vatIn ? money.parseSigned(vatIn) : null;
  if (vat !== null && (Number.isNaN(vat) || vat < 0 || vat > amount)) return fail('מע״מ: מספר בין 0 לסכום הקבלה');
  const docNo = str(f, 'document_number');
  if (docNo && docNo.length > 40) return fail('מספר מסמך ארוך מדי');
  const cat = uuid(f, 'category_id');
  try {
    await inTx(async c => {
      const { rows: [imp] } = await c.query(`SELECT id, status, file_id FROM statement_imports WHERE id = $1 AND owner_user_id = $2 AND source IN ('receipt', 'gmail') FOR UPDATE`, [importId, u.id]);
      if (!imp || imp.status !== 'review') throw new Refuse('הקבלה כבר טופלה');
      // The receipt's own currency (parsed from it), never assumed to be shekels
      const { rows: [cand] } = await c.query(`SELECT currency FROM import_candidates WHERE id = $1 AND import_id = $2`, [candId, importId]);
      const receiptCurrency: string = /^[A-Z]{3}$/.test(cand?.currency ?? '') ? cand.currency : 'ILS';
      const domain = a.w.kind === 'personal' ? 'personal' : a.w.domain, branch = a.w.kind === 'personal' ? null : a.w.branch;
      const scope = a.w.kind === 'personal' ? 'user' : 'shared';
      let docId: string | null = null;
      if (imp.file_id) {
        if (scope === 'shared') await c.query(`UPDATE files SET scope = 'shared' WHERE id = $1 AND owner_user_id = $2`, [imp.file_id, u.id]);
        const { rows: [d] } = await c.query(
          `INSERT INTO documents (title, doc_type, domain, branch, doc_date, notes, owner_user_id, scope, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7) RETURNING id`,
          [`${merchant}${docNo ? ` ${docNo}` : ''}`.slice(0, 200), docNo ? 'invoice' : 'receipt', domain, branch, date, null, u.id, scope]);
        await c.query(`INSERT INTO document_versions (document_id, version, file_id, created_by) VALUES ($1, 1, $2, $3)`, [d.id, imp.file_id, u.id]);
        docId = d.id;
      }
      let txId: string;
      if (match) {
        const { rows: [t] } = await c.query(`SELECT id, workspace_id FROM transactions WHERE id = $1 AND deleted_at IS NULL`, [match]);
        const ta = t ? await ledgerAccess(u, t.workspace_id) : null;
        if (!t || !ta?.canWrite) throw new Refuse('התנועה לא נמצאה');
        await c.query(`UPDATE transactions SET document_id = coalesce($2, document_id), document_number = coalesce($3, document_number), updated_at = now() WHERE id = $1`, [match, docId, docNo]);
        txId = match;
      } else {
        const catRow = cat ? (await c.query(`SELECT id, key FROM transaction_categories WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL AND kind = 'expense'`, [cat, a.w.id])).rows[0] : null;
        if (cat && !catRow) throw new Refuse('קטגוריה לא שייכת לאזור שנבחר');
        const { rows: [t] } = await c.query(
          `INSERT INTO transactions (direction, occurred_on, amount_gross, currency, merchant, counterparty_name, category, category_id, source, import_id, document_id,
             document_number, vat_included, vat_amount, dedupe_key, classification, domain, branch, owner_user_id, scope, created_by)
           VALUES ('expense', $1, $2, $16, $3, $3, $4, $5, 'receipt', $6, $7, $8, $9, $10, $11, 'personal', $12, $13, $14, $15, $14) RETURNING id`,
          [date, amount, merchant, catRow?.key ?? 'other', catRow?.id ?? null, importId, docId, docNo, !!vat, vat ?? 0, L.dedupeKey(date, amount, merchant),
            domain, branch, u.id, scope, receiptCurrency]);
        txId = t.id;
      }
      await c.query(`UPDATE import_candidates SET status = 'imported', imported_transaction_id = $2, matched_transaction_id = $3, target_workspace_id = $4 WHERE id = $1 AND import_id = $5`,
        [candId, txId, match, a.w.id, importId]);
      await c.query(`UPDATE statement_imports SET status = 'imported', imported_count = 1, completed_at = now() WHERE id = $1`, [importId]);
      await log(c, u, 'import', importId, 'commit', { receipt: true, matched: !!match });
    });
  } catch (e) {
    if (e instanceof Refuse) return fail(e.message);
    if (tableMissing(e)) return fail(NOT_READY);
    unstable_rethrow(e);
    console.error(e);
    return fail('לא נשמר, נסה שוב');
  }
  revalidatePath('/personal', 'layout');
  revalidatePath('/household', 'layout');
  revalidatePath('/finance-import');
  return { ok: true };
}
