'use server';
import { revalidatePath } from 'next/cache';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { canCreateIn, canDeleteRow, canEditRow, currentUser, type SessionUser } from '@/server/auth';
import { db } from '@/server/db';
import { decodePlace } from '@/lib/places';
import { CLASSIFICATIONS, DOCUMENT_TYPES, PAYMENT_METHODS, isCategory, isIsoDate, type Direction } from '@/lib/finance';
import money from '@domain/money';
import { ils } from '@/lib/format';

// Writes for finance (2.3) and collections (2.4). Each action: session → permission → validate every
// field → write (in one DB transaction where several rows change) → activity_log → revalidate.
// Soft delete only. The VAT rate is read from `parameters` for the row's date and stored on it.

export type FinanceResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE = 4 * 1024 * 1024;
const fail = (error: string): FinanceResult => ({ ok: false, error });

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
const bool = (f: FormData, k: string) => ['on', 'true', '1'].includes(String(f.get(k) ?? ''));

function finish(path: string | null): FinanceResult {
  revalidatePath(path && path.startsWith('/') && !path.startsWith('//') ? path.split('?')[0] : '/', 'layout');
  return { ok: true };
}

async function log(c: PoolClient, u: SessionUser, type: string, id: string, action: string, meta: Record<string, unknown> = {}) {
  await c.query(`INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, $2, $3, $4, $5)`,
    [u.id, type, id, action, JSON.stringify(meta)]);
}

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

const tableMissing = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string })?.code ?? '');
const NOT_READY = 'טבלאות הכספים עוד לא נוצרו במסד';

async function vatRateOn(c: PoolClient, dateIso: string): Promise<number | null> {
  const { rows } = await c.query(
    `SELECT value FROM parameters WHERE key = 'vat_rate' AND effective_from <= $1::date ORDER BY effective_from DESC LIMIT 1`, [dateIso]);
  const r = rows[0]?.value?.rate;
  return typeof r === 'number' ? r : null;
}

// Validated place from the packed `place` field ("domain|branch|location"), checked against the DB
async function readPlace(c: PoolClient, packed: string | null) {
  const p = packed ? decodePlace(packed) : null;
  if (!p) return 'שיוך לא תקין';
  if (p.branch) {
    const { rows } = await c.query(`SELECT 1 FROM branches WHERE domain = $1 AND branch = $2`, [p.domain, p.branch]);
    if (!rows.length) return 'עסק לא תקין';
  }
  if (p.location) {
    if (!p.branch) return 'סניף בלי עסק';
    const { rows } = await c.query(`SELECT 1 FROM locations WHERE branch = $1 AND location = $2`, [p.branch, p.location]);
    if (!rows.length) return 'סניף לא תקין';
  }
  return p;
}

async function saveFile(c: PoolClient, f: FormData, u: SessionUser, scope: string): Promise<string | null | { error: string }> {
  const file = f.get('file');
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_FILE) return { error: 'הקובץ גדול מ-4MB' };
  const buf = Buffer.from(await file.arrayBuffer());
  const sha = createHash('sha256').update(buf).digest('hex');
  const { rows } = await c.query(
    `INSERT INTO files (name, mime, size_bytes, sha256, data, owner_user_id, scope) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [(file.name || 'מסמך').slice(0, 200), (file.type || 'application/octet-stream').slice(0, 100), buf.length, sha, buf, u.id, scope]);
  return rows[0].id;
}

class Refuse extends Error {}

// ── Transactions ──────────────────────────────────────────────────────────────
export async function addTransaction(_: FinanceResult | null, f: FormData): Promise<FinanceResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');

  const direction = str(f, 'direction') as Direction | null;
  if (direction !== 'income' && direction !== 'expense') return fail('בחר הכנסה או הוצאה');
  const occurred = str(f, 'occurred_on');
  if (!isIsoDate(occurred)) return fail('צריך תאריך תקין');
  const gross = money.parseAmount(str(f, 'amount'));
  if (gross === null) return fail('סכום חייב להיות מספר חיובי (עד 2 ספרות אחרי הנקודה)');
  const vatIncluded = bool(f, 'vat_included');
  const category = str(f, 'category') ?? 'other';
  if (!isCategory(direction, category)) return fail('קטגוריה לא תקינה');
  const description = str(f, 'description');
  if (description && description.length > 500) return fail('התיאור ארוך מדי (עד 500 תווים)');
  const documentType = str(f, 'document_type') ?? 'none';
  if (!DOCUMENT_TYPES.some(d => d.id === documentType)) return fail('סוג מסמך לא תקין');
  const documentNumber = str(f, 'document_number');
  if (documentNumber && documentNumber.length > 40) return fail('מספר מסמך ארוך מדי');
  const counterparty = str(f, 'counterparty_name');
  if (counterparty && counterparty.length > 120) return fail('שם הצד השני ארוך מדי');
  const taxId = str(f, 'counterparty_tax_id');
  if (taxId && !money.validTaxId(taxId)) return fail('ח״פ / ע״מ: ספרות בלבד, 5 עד 9');
  const method = str(f, 'payment_method');
  if (method && !PAYMENT_METHODS.some(m => m.id === method)) return fail('אמצעי תשלום לא תקין');
  const paymentDate = str(f, 'payment_date');
  if (paymentDate && !isIsoDate(paymentDate)) return fail('תאריך תשלום לא תקין');
  const classification = str(f, 'classification');
  if (!CLASSIFICATIONS.some(c => c.id === classification)) return fail('בחר סיווג: עסקי, פרטי או מעורב');
  const scope = str(f, 'scope') ?? 'user';
  if (scope !== 'user' && scope !== 'shared') return fail('הרשאה לא תקינה');

  // Split between people: share_<userId> fields, only when "split" is on
  let splits: { user_id: string; share_pct: number }[] = [];
  if (bool(f, 'split')) {
    for (const [k, v] of f.entries()) {
      if (!k.startsWith('share_') || typeof v !== 'string' || v.trim() === '') continue;
      const id = k.slice(6);
      const pct = money.parseNumber(v) ?? NaN;
      if (!/^[a-z][a-z0-9-]{1,30}$/.test(id) || !Number.isFinite(pct)) return fail('חלוקה לא תקינה');
      splits.push({ user_id: id, share_pct: pct });
    }
    if (!money.validSplits(splits)) return fail('החלוקה צריכה להסתכם ב-100% בין שני אנשים לפחות');
    if (scope !== 'shared') return fail('הוצאה מחולקת חייבת להיות משותפת');
  } else splits = [];

  try {
    const id = await inTx(async c => {
      const p = await readPlace(c, str(f, 'place'));
      if (typeof p === 'string') throw new Refuse(p);
      if (!canCreateIn(u, p, 'money')) throw new Refuse('אין לך הרשאה להוסיף תנועות כאן');
      if (splits.length) {
        const { rows } = await c.query(`SELECT id FROM users WHERE id = ANY($1::text[])`, [splits.map(s => s.user_id)]);
        if (rows.length !== splits.length) throw new Refuse('משתמש לא מוכר בחלוקה');
      }
      const rate = await vatRateOn(c, occurred);
      if (rate === null) throw new Refuse('אין שיעור מע״מ מוגדר לתאריך הזה. צריך להוסיף אותו בפרמטרים לפני שמירה.');
      const v = money.vatSplit(gross, rate, vatIncluded);
      if (!v) throw new Refuse('לא ניתן לחשב מע״מ');
      const fileId = await saveFile(c, f, u, scope);
      if (fileId && typeof fileId === 'object') throw new Refuse(fileId.error);
      const { rows } = await c.query(
        `INSERT INTO transactions (direction, occurred_on, amount_gross, vat_included, vat_rate, vat_amount, category, description,
           document_type, document_number, counterparty_name, counterparty_tax_id, payment_method, payment_date, classification,
           domain, branch, location, file_id, owner_user_id, scope, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$20) RETURNING id`,
        [direction, occurred, v.gross, vatIncluded, rate, v.vat, category, description, documentType, documentNumber, counterparty,
          taxId, method, paymentDate, classification, p.domain, p.branch, p.location, fileId, u.id, scope]);
      const txId: string = rows[0].id;
      for (const s of splits) {
        await c.query(`INSERT INTO transaction_splits (transaction_id, user_id, share_pct) VALUES ($1, $2, $3)`, [txId, s.user_id, s.share_pct]);
      }
      await log(c, u, 'transaction', txId, 'create', {
        direction, amount_gross: v.gross, vat_amount: v.vat, vat_rate: rate, classification, place: p, file: Boolean(fileId), splits,
      });
      return txId;
    });
    void id;
  } catch (e) {
    if (e instanceof Refuse) return fail(e.message);
    if (tableMissing(e)) return fail(NOT_READY);
    console.error(e);
    return fail('לא נשמר, נסה שוב');
  }
  return finish(str(f, 'path'));
}

export async function removeTransaction(id: string, path: string): Promise<FinanceResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  if (typeof id !== 'string' || !UUID.test(id)) return fail('בקשה לא תקינה');
  try {
    await inTx(async c => {
      const { rows } = await c.query(
        `SELECT t.domain, t.branch, t.location, t.owner_user_id, t.scope, to_jsonb(t) ->> 'subject_type' AS subject_type,
                EXISTS (SELECT 1 FROM receivables r WHERE r.id = t.receivable_id AND r.deleted_at IS NULL) AS from_open_receivable
         FROM transactions t WHERE t.id = $1 AND t.deleted_at IS NULL FOR UPDATE OF t`, [id]);
      const row = rows[0];
      if (!row || !canDeleteRow(u, 'money', row)) throw new Refuse('לא נמצא או שאין הרשאה למחוק');
      // A collection's income row stays while its receivable exists (the payment would point at nothing)
      if (row.from_open_receivable) throw new Refuse('התנועה נרשמה מתשלום של חוב בגבייה ולכן לא נמחקת מכאן');
      // A loan repayment is undone from the loan, so the balance is restored with it
      if (row.subject_type === 'liability') throw new Refuse('זה החזר הלוואה. מבטלים אותו מדף הנכס, כדי שגם יתרת ההלוואה תתעדכן');
      await c.query(`UPDATE transactions SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
      await log(c, u, 'transaction', id, 'delete');
    });
  } catch (e) {
    if (e instanceof Refuse) return fail(e.message);
    if (tableMissing(e)) return fail(NOT_READY);
    console.error(e);
    return fail('לא נמחק, נסה שוב');
  }
  return finish(path);
}

// ── Receivables ───────────────────────────────────────────────────────────────
export async function addReceivable(_: FinanceResult | null, f: FormData): Promise<FinanceResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  const client = str(f, 'client_name');
  if (!client || client.length > 120) return fail('צריך שם לקוח (עד 120 תווים)');
  const taxId = str(f, 'client_tax_id');
  if (taxId && !money.validTaxId(taxId)) return fail('ח״פ / ע״מ: ספרות בלבד, 5 עד 9');
  const amount = money.parseAmount(str(f, 'amount'));
  if (amount === null) return fail('סכום חייב להיות מספר חיובי');
  const issued = str(f, 'issued_on');
  if (issued && !isIsoDate(issued)) return fail('תאריך הפקה לא תקין');
  const due = str(f, 'due_date');
  if (!isIsoDate(due)) return fail('צריך תאריך לתשלום');
  if (issued && due < issued) return fail('תאריך התשלום לפני תאריך ההפקה');
  const invoice = str(f, 'invoice_number');
  if (invoice && invoice.length > 40) return fail('מספר חשבונית ארוך מדי');
  const note = str(f, 'note');
  if (note && note.length > 500) return fail('ההערה ארוכה מדי');
  try {
    await inTx(async c => {
      const p = await readPlace(c, str(f, 'place'));
      if (typeof p === 'string') throw new Refuse(p);
      if (!canCreateIn(u, p, 'money')) throw new Refuse('אין לך הרשאה להוסיף חוב כאן');
      const fileId = await saveFile(c, f, u, 'shared');
      if (fileId && typeof fileId === 'object') throw new Refuse(fileId.error);
      const { rows } = await c.query(
        `INSERT INTO receivables (client_name, client_tax_id, amount, issued_on, due_date, invoice_number, invoice_file_id, note,
           domain, branch, location, owner_user_id, scope)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'shared') RETURNING id`,
        [client, taxId, amount, issued, due, invoice, fileId, note, p.domain, p.branch, p.location, u.id]);
      await log(c, u, 'receivable', rows[0].id, 'create', { amount, due_date: due, place: p });
    });
  } catch (e) {
    if (e instanceof Refuse) return fail(e.message);
    if (tableMissing(e)) return fail(NOT_READY);
    console.error(e);
    return fail('לא נשמר, נסה שוב');
  }
  return finish(str(f, 'path'));
}

// A payment: receivable_payments row + amount_paid/status/paid_at, and (by default) an income
// transaction for it — all in one DB transaction with the receivable row locked.
export async function recordPayment(_: FinanceResult | null, f: FormData): Promise<FinanceResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  const id = str(f, 'id');
  if (!id || !UUID.test(id)) return fail('בקשה לא תקינה');
  const amount = money.parseAmount(str(f, 'amount'));
  if (amount === null) return fail('סכום חייב להיות מספר חיובי');
  const paidOn = str(f, 'paid_on');
  if (!isIsoDate(paidOn)) return fail('צריך תאריך תשלום');
  const method = str(f, 'payment_method');
  if (method && !PAYMENT_METHODS.some(m => m.id === method)) return fail('אמצעי תשלום לא תקין');
  // Default on. The form sends record_income_field=1 next to its checkbox, so an unticked box means off.
  const recordIncome = f.get('record_income_field') === null ? true : bool(f, 'record_income');
  try {
    await inTx(async c => {
      const { rows } = await c.query(
        `SELECT id, client_name, client_tax_id, amount::float AS amount, amount_paid::float AS amount_paid, status, invoice_number,
                domain, branch, location, owner_user_id, scope
         FROM receivables WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      const r = rows[0];
      if (!r || !canEditRow(u, 'money', r)) throw new Refuse('לא נמצא או שאין הרשאה');
      const next = money.applyPayment(r.amount, r.amount_paid, amount);
      if (next.error === 'already_paid') throw new Refuse('החוב כבר שולם במלואו');
      if (next.error === 'too_much') throw new Refuse(`הסכום גדול מהיתרה (${ils(money.round2(r.amount - r.amount_paid))})`);
      if (next.error) throw new Refuse('סכום לא תקין');
      let txId: string | null = null;
      if (recordIncome) {
        const rate = await vatRateOn(c, paidOn);
        if (rate === null) throw new Refuse('אין שיעור מע״מ מוגדר לתאריך התשלום. אפשר לרשום בלי תנועת הכנסה, או להוסיף את השיעור בפרמטרים.');
        const v = money.vatSplit(amount, rate, true)!;
        const { rows: t } = await c.query(
          `INSERT INTO transactions (direction, occurred_on, amount_gross, vat_included, vat_rate, vat_amount, category, description,
             document_type, document_number, counterparty_name, counterparty_tax_id, payment_method, payment_date, classification,
             domain, branch, location, receivable_id, owner_user_id, scope, created_by)
           VALUES ('income', $1, $2, true, $3, $4, 'client-payment', $5, 'none', $6, $7, $8, $9, $1, 'business',
                   $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
          [paidOn, v.gross, rate, v.vat, `תשלום על חוב: ${r.client_name}`.slice(0, 500), r.invoice_number, r.client_name, r.client_tax_id,
            method, r.domain, r.branch, r.location, r.id, r.owner_user_id, r.scope, u.id]);
        txId = t[0].id;
      }
      const { rows: pay } = await c.query(
        `INSERT INTO receivable_payments (receivable_id, amount, paid_on, payment_method, transaction_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [r.id, amount, paidOn, method, txId, u.id]);
      await c.query(
        `UPDATE receivables SET amount_paid = $2, status = $3, updated_at = now(),
           paid_at = CASE WHEN $3 = 'paid' THEN now() ELSE NULL END WHERE id = $1`,
        [r.id, next.amount_paid, next.status]);
      await log(c, u, 'receivable', r.id, 'payment', { payment_id: pay[0].id, amount, paid_on: paidOn, status: next.status, transaction_id: txId });
    });
  } catch (e) {
    if (e instanceof Refuse) return fail(e.message);
    if (tableMissing(e)) return fail(NOT_READY);
    console.error(e);
    return fail('התשלום לא נרשם, נסה שוב');
  }
  return finish(str(f, 'path'));
}

export async function removeReceivable(id: string, path: string): Promise<FinanceResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  if (typeof id !== 'string' || !UUID.test(id)) return fail('בקשה לא תקינה');
  try {
    await inTx(async c => {
      const { rows } = await c.query(
        `SELECT domain, branch, location, owner_user_id, scope FROM receivables WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      if (!rows[0] || !canDeleteRow(u, 'money', rows[0])) throw new Refuse('לא נמצא או שאין הרשאה למחוק');
      await c.query(`UPDATE receivables SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
      await log(c, u, 'receivable', id, 'delete');
    });
  } catch (e) {
    if (e instanceof Refuse) return fail(e.message);
    if (tableMissing(e)) return fail(NOT_READY);
    console.error(e);
    return fail('לא נמחק, נסה שוב');
  }
  return finish(path);
}
