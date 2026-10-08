'use server';
import { todayIL } from '@/lib/period';
import { revalidatePath } from 'next/cache';
import type { PoolClient } from 'pg';
import { canCreateIn, canDeleteRow, canEditRow, currentUser, type Kind, type PlaceRef, type SessionUser } from '@/server/auth';
import { db } from '@/server/db';
import { CLASSIFICATIONS, PAYMENT_METHODS, isCategory, isIsoDate, type Direction } from '@/lib/finance';
import money from '@domain/money';
import ventures from '@domain/ventures';

// Writes for ventures (stage 3.3): properties, loans and repayments, investments, legal cases with
// deadlines, and the tasks/contacts/money linked to them. Each action: session → permission →
// validate every field → write (one DB transaction) → activity_log → revalidate. Soft delete only.
// A loan repayment is written twice, as the rule says: the venture share as a ventures expense and
// the rest as a personal expense, both linked to the loan (subject liability), split by venture_share_pct.

export type VenturesResult = { ok: true; id?: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string): VenturesResult => ({ ok: false, error });
const NOT_READY = 'טבלאות היזמות עוד לא נוצרו במסד';

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
const bool = (f: FormData, k: string) => ['on', 'true', '1'].includes(String(f.get(k) ?? ''));
const tooLong = (v: string | null, max: number) => v !== null && v.length > max;

function finish(path: unknown, id?: string): VenturesResult {
  const p = typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path.split('?')[0] : '/ventures';
  revalidatePath(p, 'layout');
  revalidatePath('/ventures', 'layout');
  return { ok: true, id };
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

class Refuse extends Error {}
const tableMissing = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string })?.code ?? '');

// Run a write; turn refusals and missing tables into a message
async function run(u: SessionUser | null, fn: (u: SessionUser) => Promise<string | void>, path: unknown): Promise<VenturesResult> {
  if (!u) return fail('לא מחובר');
  let id: string | void;
  try {
    id = await fn(u);
  } catch (e) {
    if (e instanceof Refuse) return fail(e.message);
    if (tableMissing(e)) return fail(NOT_READY);
    if ((e as { code?: string })?.code === '23514') return fail('ערך לא תקין באחד השדות');
    console.error(e);
    return fail('לא נשמר, נסה שוב');
  }
  return finish(path, id || undefined);
}

async function vatRateOn(c: PoolClient, dateIso: string): Promise<number | null> {
  const { rows } = await c.query(
    `SELECT value FROM parameters WHERE key = 'vat_rate' AND effective_from <= $1::date ORDER BY effective_from DESC LIMIT 1`, [dateIso]);
  const r = rows[0]?.value?.rate;
  return typeof r === 'number' ? r : null;
}

// Optional amount field: empty → null, invalid → Refuse
function optAmount(f: FormData, k: string, label: string): number | null {
  const v = str(f, k);
  if (v === null) return null;
  const a = money.parseAmount(v);
  if (a === null) throw new Refuse(`${label}: מספר חיובי (עד 2 ספרות אחרי הנקודה)`);
  return a;
}
function optDate(f: FormData, k: string, label: string): string | null {
  const v = str(f, k);
  if (v === null) return null;
  if (!isIsoDate(v)) throw new Refuse(`${label}: תאריך לא תקין`);
  return v;
}
function scopeOf(f: FormData): 'user' | 'shared' {
  const s = str(f, 'scope') ?? 'user';
  if (s !== 'user' && s !== 'shared') throw new Refuse('הרשאה לא תקינה');
  return s;
}

// ── Subjects: the object a task / contact / transaction / deadline is about ────
type SubjectType = 'asset' | 'liability' | 'investment' | 'legal_case';
const SUBJECT: Record<SubjectType, { table: string; kind: Kind; label: string }> = {
  asset: { table: 'assets', kind: 'money', label: 'נכס' },
  liability: { table: 'liabilities', kind: 'money', label: 'הלוואה' },
  investment: { table: 'investments', kind: 'money', label: 'השקעה' },
  legal_case: { table: 'legal_cases', kind: 'task', label: 'תיק' },
};
type SubjectRow = PlaceRef & { id: string; domain: string; branch: string; owner_user_id: string; scope: 'user' | 'shared'; [k: string]: unknown };

async function loadSubject(c: PoolClient, u: SessionUser, type: unknown, id: unknown, lock = false): Promise<{ type: SubjectType; row: SubjectRow }> {
  if (typeof type !== 'string' || !(type in SUBJECT) || typeof id !== 'string' || !UUID.test(id)) throw new Refuse('בקשה לא תקינה');
  const s = SUBJECT[type as SubjectType];
  const { rows } = await c.query(`SELECT * FROM ${s.table} WHERE id = $1 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [id]);
  const row = rows[0];
  if (!row || !canEditRow(u, s.kind, row)) throw new Refuse(`ה${s.label} לא נמצא או שאין הרשאה לשנות אותו`);
  return { type: type as SubjectType, row };
}

// ── Properties ────────────────────────────────────────────────────────────────
const ASSET_KINDS = ['apartment', 'house', 'commercial', 'land', 'other'];
const PROPERTY_SOURCES = ['estimate', 'appraisal', 'purchase'];

export async function addProperty(_: VenturesResult | null, f: FormData): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    const name = str(f, 'name');
    if (!name || name.length > 120) throw new Refuse('שם הנכס: 1 עד 120 תווים');
    const kind = str(f, 'kind') ?? 'apartment';
    if (!ASSET_KINDS.includes(kind)) throw new Refuse('סוג נכס לא תקין');
    const address = str(f, 'address');
    if (tooLong(address, 200)) throw new Refuse('הכתובת ארוכה מדי');
    const purchaseDate = optDate(f, 'purchase_date', 'תאריך רכישה');
    const cost = optAmount(f, 'purchase_cost', 'עלות רכישה');
    const value = optAmount(f, 'current_value', 'שווי נוכחי');
    let source = str(f, 'value_source');
    let valueDate = optDate(f, 'value_date', 'תאריך השווי');
    if (value !== null) {
      if (!source || !PROPERTY_SOURCES.includes(source)) throw new Refuse('בחר מקור לשווי: הערכה, שמאות או מחיר רכישה');
      valueDate = valueDate ?? todayIL();
    } else { source = null; valueDate = null; }
    const notes = str(f, 'notes');
    if (tooLong(notes, 2000)) throw new Refuse('ההערות ארוכות מדי');
    const scope = scopeOf(f);
    if (!canCreateIn(u, { domain: 'ventures', branch: 'real-estate' }, 'money')) throw new Refuse('אין לך הרשאה להוסיף נכסים');
    return inTx(async c => {
      const { rows } = await c.query(
        `INSERT INTO assets (kind, name, address, purchase_date, purchase_cost, current_value, value_date, value_source, notes, owner_user_id, scope, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10) RETURNING id`,
        [kind, name, address, purchaseDate, cost, value, valueDate, source, notes, u.id, scope]);
      await log(c, u, 'asset', rows[0].id, 'create', { name, purchase_cost: cost, current_value: value, value_source: source });
      return rows[0].id as string;
    });
  }, str(f, 'path'));
}

export async function updatePropertyValue(_: VenturesResult | null, f: FormData): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    const value = optAmount(f, 'current_value', 'שווי נוכחי');
    if (value === null) throw new Refuse('צריך שווי');
    const source = str(f, 'value_source');
    if (!source || !PROPERTY_SOURCES.includes(source)) throw new Refuse('בחר מקור לשווי');
    const valueDate = optDate(f, 'value_date', 'תאריך השווי');
    if (!valueDate) throw new Refuse('צריך תאריך לשווי');
    await inTx(async c => {
      const { row } = await loadSubject(c, u, 'asset', str(f, 'id'), true);
      await c.query(`UPDATE assets SET current_value = $2, value_date = $3, value_source = $4, updated_at = now() WHERE id = $1`,
        [row.id, value, valueDate, source]);
      await log(c, u, 'asset', row.id, 'update_value', { from: row.current_value, to: value, value_date: valueDate, value_source: source });
    });
  }, str(f, 'path'));
}

export async function removeProperty(id: string, path: string): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    await inTx(async c => {
      const { row } = await loadSubject(c, u, 'asset', id, true);
      if (!canDeleteRow(u, 'money', row)) throw new Refuse('אין הרשאה למחוק את הנכס');
      await c.query(`UPDATE assets SET deleted_at = now(), updated_at = now() WHERE id = $1`, [row.id]);
      // Its loans go with it (soft); their repayment transactions stay in the books
      const { rows } = await c.query(`UPDATE liabilities SET deleted_at = now(), updated_at = now() WHERE asset_id = $1 AND deleted_at IS NULL RETURNING id`, [row.id]);
      await log(c, u, 'asset', row.id, 'delete', { liabilities: rows.map(r => r.id) });
    });
  }, path);
}

// ── Loans ─────────────────────────────────────────────────────────────────────
export async function addLoan(_: VenturesResult | null, f: FormData): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    const lender = str(f, 'lender');
    if (!lender || lender.length > 120) throw new Refuse('שם המלווה: 1 עד 120 תווים');
    const kind = str(f, 'kind') ?? 'mortgage';
    if (!['mortgage', 'loan', 'other'].includes(kind)) throw new Refuse('סוג הלוואה לא תקין');
    const principal = optAmount(f, 'principal', 'סכום ההלוואה');
    if (principal === null) throw new Refuse('צריך סכום הלוואה');
    const rate = ventures.parseRatePct(str(f, 'annual_rate_pct'));
    if (rate === null) throw new Refuse('ריבית שנתית באחוזים, למשל 4.5');
    const start = optDate(f, 'start_date', 'תאריך תחילה');
    if (!start) throw new Refuse('צריך תאריך תחילה');
    const term = Number(str(f, 'term_months'));
    if (!Number.isInteger(term) || term < 1 || term > 600) throw new Refuse('תקופה בחודשים: 1 עד 600');
    const payment = optAmount(f, 'monthly_payment', 'החזר חודשי') ?? ventures.monthlyPayment(principal, rate, term);
    if (payment === null) throw new Refuse('לא ניתן לחשב החזר חודשי');
    // 0 is a real balance (a loan paid off)
    const balanceIn = money.parseSigned(str(f, 'balance'));
    const balance = balanceIn === null ? principal : balanceIn;
    if (Number.isNaN(balance) || balance < 0 || balance > principal * 1.5) throw new Refuse('יתרה: מספר 0 ומעלה');
    const balanceDate = optDate(f, 'balance_date', 'תאריך היתרה') ?? start;
    const share = ventures.parsePct(str(f, 'venture_share_pct') ?? '100');
    if (share === null) throw new Refuse('חלק היזמות: 0 עד 100 אחוז');
    const notes = str(f, 'notes');
    if (tooLong(notes, 1000)) throw new Refuse('ההערות ארוכות מדי');
    if (!canCreateIn(u, { domain: 'ventures', branch: 'real-estate' }, 'money')) throw new Refuse('אין לך הרשאה להוסיף הלוואות');
    return inTx(async c => {
      const { row: asset } = await loadSubject(c, u, 'asset', str(f, 'asset_id'));
      const { rows } = await c.query(
        `INSERT INTO liabilities (asset_id, kind, lender, principal, annual_rate, start_date, term_months, monthly_payment, balance, balance_date,
           venture_share_pct, notes, owner_user_id, scope, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$13) RETURNING id`,
        [asset.id, kind, lender, principal, rate, start, term, payment, balance, balanceDate, share, notes, u.id, asset.scope]);
      await log(c, u, 'liability', rows[0].id, 'create', { asset_id: asset.id, principal, annual_rate: rate, term_months: term, monthly_payment: payment, venture_share_pct: share });
      return rows[0].id as string;
    });
  }, str(f, 'path'));
}

// One repayment → interest/principal split, two expense transactions (venture + personal by the loan's
// split), the loan's balance goes down by the principal part. Repayments are recorded in date order.
export async function recordRepayment(_: VenturesResult | null, f: FormData): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    const paidOn = optDate(f, 'paid_on', 'תאריך');
    if (!paidOn) throw new Refuse('צריך תאריך');
    const method = str(f, 'payment_method');
    if (method && !PAYMENT_METHODS.some(m => m.id === method)) throw new Refuse('אמצעי תשלום לא תקין');
    return inTx(async c => {
      const { row: loan } = await loadSubject(c, u, 'liability', str(f, 'liability_id'), true);
      const amount = optAmount(f, 'amount', 'סכום') ?? Number(loan.monthly_payment);
      if (loan.status !== 'active') throw new Refuse('ההלוואה סגורה');
      const { rows: bd } = await c.query(`SELECT to_char(balance_date, 'YYYY-MM-DD') AS d FROM liabilities WHERE id = $1`, [loan.id]);
      const balanceDate: string = bd[0].d;
      if (paidOn < balanceDate) throw new Refuse(`החזרים נרשמים לפי הסדר: התאריך צריך להיות אחרי ${balanceDate}`);
      const split = ventures.splitPayment(Number(loan.balance), Number(loan.annual_rate), amount);
      if (split.error === 'too_much') throw new Refuse('הסכום גדול מהיתרה והריבית');
      if (split.error) throw new Refuse('ההלוואה כבר נפרעה או שהסכום לא תקין');
      const pct = Number(loan.venture_share_pct);
      const share = ventures.shareSplit(amount, pct);
      if (!share) throw new Refuse('חלוקה לא תקינה');
      const venturePlace = { domain: 'ventures', branch: loan.branch as string, location: null };
      const personalPlace = { domain: 'personal', branch: null, location: null };
      if (share.venture > 0 && !canCreateIn(u, venturePlace, 'money')) throw new Refuse('אין לך הרשאה לרשום הוצאה ביזמות');
      if (share.personal > 0 && !canCreateIn(u, personalPlace, 'money')) throw new Refuse('אין לך הרשאה לרשום הוצאה באזור האישי');
      const rate = await vatRateOn(c, paidOn);
      const desc = (part: string) => `החזר ${loan.kind === 'mortgage' ? 'משכנתא' : 'הלוואה'} · ${loan.lender} · ${part}`.slice(0, 500);
      const insertTx = async (place: PlaceRef, gross: number, part: string) => {
        const { rows } = await c.query(
          `INSERT INTO transactions (direction, occurred_on, amount_gross, vat_included, vat_rate, vat_amount, category, description,
             document_type, counterparty_name, payment_method, payment_date, classification, domain, branch, location,
             owner_user_id, scope, created_by, subject_type, subject_id)
           VALUES ('expense', $1, $2, false, $3, 0, 'rent', $4, 'none', $5, $6, $1, 'personal', $7, $8, NULL, $9, $10, $11, 'liability', $12)
           RETURNING id`,
          [paidOn, gross, rate, desc(part), String(loan.lender).slice(0, 120), method, place.domain, place.branch ?? null,
            loan.owner_user_id, loan.scope, u.id, loan.id]);
        return rows[0].id as string;
      };
      const ventureTx = share.venture > 0 ? await insertTx(venturePlace, share.venture, pct === 100 ? 'יזמות' : `חלק יזמות ${pct}%`) : null;
      const personalTx = share.personal > 0 ? await insertTx(personalPlace, share.personal, `חלק אישי ${ventures.round2(100 - pct)}%`) : null;
      const { rows } = await c.query(
        `INSERT INTO liability_payments (liability_id, paid_on, amount, interest, principal, balance_before, balance_after, balance_date_before,
           venture_share_pct, venture_tx_id, personal_tx_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [loan.id, paidOn, amount, split.interest, split.principal, loan.balance, split.balance_after, balanceDate, pct, ventureTx, personalTx, u.id]);
      await c.query(
        `UPDATE liabilities SET balance = $2, balance_date = $3, status = CASE WHEN $2::numeric = 0 THEN 'closed' ELSE status END, updated_at = now()
         WHERE id = $1`, [loan.id, split.balance_after, paidOn]);
      await log(c, u, 'liability', String(loan.id), 'repayment', {
        payment_id: rows[0].id, amount, interest: split.interest, principal: split.principal, balance_after: split.balance_after,
        venture_share_pct: pct, venture_amount: share.venture, personal_amount: share.personal, venture_tx_id: ventureTx, personal_tx_id: personalTx,
      });
      return rows[0].id as string;
    });
  }, str(f, 'path'));
}

// Undo the latest repayment of a loan: both its transactions are soft-deleted and the balance returns
export async function undoRepayment(paymentId: string, path: string): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    if (typeof paymentId !== 'string' || !UUID.test(paymentId)) throw new Refuse('בקשה לא תקינה');
    await inTx(async c => {
      const { rows } = await c.query(
        `SELECT *, to_char(balance_date_before, 'YYYY-MM-DD') AS balance_date_before FROM liability_payments WHERE id = $1 AND deleted_at IS NULL`, [paymentId]);
      const p = rows[0];
      if (!p) throw new Refuse('ההחזר לא נמצא');
      const { row: loan } = await loadSubject(c, u, 'liability', p.liability_id, true);
      if (!canDeleteRow(u, 'money', loan)) throw new Refuse('אין הרשאה לבטל החזר');
      const { rows: later } = await c.query(
        `SELECT 1 FROM liability_payments WHERE liability_id = $1 AND deleted_at IS NULL AND id <> $2 AND created_at > $3`, [loan.id, p.id, p.created_at]);
      if (later.length) throw new Refuse('אפשר לבטל רק את ההחזר האחרון');
      await c.query(`UPDATE liability_payments SET deleted_at = now() WHERE id = $1`, [p.id]);
      await c.query(`UPDATE transactions SET deleted_at = now(), updated_at = now() WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [[p.venture_tx_id, p.personal_tx_id].filter(Boolean)]);
      await c.query(`UPDATE liabilities SET balance = $2, balance_date = $3, status = 'active', updated_at = now() WHERE id = $1`,
        [loan.id, p.balance_before, p.balance_date_before]);
      await log(c, u, 'liability', String(loan.id), 'repayment_undo', { payment_id: p.id, balance: p.balance_before });
    });
  }, path);
}

export async function removeLoan(id: string, path: string): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    await inTx(async c => {
      const { row } = await loadSubject(c, u, 'liability', id, true);
      if (!canDeleteRow(u, 'money', row)) throw new Refuse('אין הרשאה למחוק את ההלוואה');
      await c.query(`UPDATE liabilities SET deleted_at = now(), updated_at = now() WHERE id = $1`, [row.id]);
      await log(c, u, 'liability', row.id, 'delete');
    });
  }, path);
}

// ── Money linked to an object (property income/expenses, investment flows, legal payments) ──
const SUBJECT_BRANCH: Record<string, string> = { asset: 'real-estate', investment: 'investments', legal_case: 'legal-and-tasks' };

export async function addSubjectTransaction(_: VenturesResult | null, f: FormData): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    const subjectType = str(f, 'subject_type');
    if (!subjectType || !(subjectType in SUBJECT_BRANCH)) throw new Refuse('בקשה לא תקינה');
    const direction = str(f, 'direction') as Direction | null;
    if (direction !== 'income' && direction !== 'expense') throw new Refuse('בחר הכנסה או הוצאה');
    const occurred = optDate(f, 'occurred_on', 'תאריך');
    if (!occurred) throw new Refuse('צריך תאריך');
    const gross = optAmount(f, 'amount', 'סכום');
    if (gross === null) throw new Refuse('צריך סכום');
    const vatIncluded = bool(f, 'vat_included');
    const category = str(f, 'category') ?? 'other';
    if (!isCategory(direction, category)) throw new Refuse('קטגוריה לא תקינה');
    const description = str(f, 'description');
    if (tooLong(description, 500)) throw new Refuse('התיאור ארוך מדי');
    const counterparty = str(f, 'counterparty_name');
    if (tooLong(counterparty, 120)) throw new Refuse('שם הצד השני ארוך מדי');
    const classification = str(f, 'classification') ?? 'personal';
    if (!CLASSIFICATIONS.some(x => x.id === classification)) throw new Refuse('סיווג לא תקין');
    const method = str(f, 'payment_method');
    if (method && !PAYMENT_METHODS.some(m => m.id === method)) throw new Refuse('אמצעי תשלום לא תקין');
    return inTx(async c => {
      const { row } = await loadSubject(c, u, subjectType, str(f, 'subject_id'));
      const place = { domain: 'ventures', branch: SUBJECT_BRANCH[subjectType], location: null };
      if (!canCreateIn(u, place, 'money')) throw new Refuse('אין לך הרשאה לרשום תנועות כאן');
      const rate = await vatRateOn(c, occurred);
      if (vatIncluded && rate === null) throw new Refuse('אין שיעור מע״מ מוגדר לתאריך הזה. צריך להוסיף אותו בפרמטרים לפני שמירה.');
      const v = money.vatSplit(gross, rate, vatIncluded);
      if (!v) throw new Refuse('לא ניתן לחשב מע״מ');
      const { rows } = await c.query(
        `INSERT INTO transactions (direction, occurred_on, amount_gross, vat_included, vat_rate, vat_amount, category, description,
           document_type, counterparty_name, payment_method, payment_date, classification, domain, branch, location,
           owner_user_id, scope, created_by, subject_type, subject_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'none',$9,$10,$2,$11,$12,$13,NULL,$14,$15,$14,$16,$17) RETURNING id`,
        [direction, occurred, v.gross, vatIncluded, rate, v.vat, category, description, counterparty, method, classification,
          place.domain, place.branch, u.id, row.scope, subjectType, row.id]);
      await log(c, u, 'transaction', rows[0].id, 'create', { direction, amount_gross: v.gross, vat_amount: v.vat, subject_type: subjectType, subject_id: row.id });
      return rows[0].id as string;
    });
  }, str(f, 'path'));
}

// ── Investments ───────────────────────────────────────────────────────────────
const INV_CATEGORIES = ['stocks', 'bonds', 'fund', 'pension', 'deposit', 'crypto', 'private', 'real-estate', 'other'];
const INV_SOURCES = ['estimate', 'statement', 'market'];

export async function addInvestment(_: VenturesResult | null, f: FormData): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    const name = str(f, 'name');
    if (!name || name.length > 120) throw new Refuse('שם ההשקעה: 1 עד 120 תווים');
    const category = str(f, 'category') ?? 'other';
    if (!INV_CATEGORIES.includes(category)) throw new Refuse('קטגוריה לא תקינה');
    const amount = optAmount(f, 'amount_invested', 'סכום ההשקעה');
    if (amount === null) throw new Refuse('צריך סכום השקעה');
    const investedOn = optDate(f, 'invested_on', 'תאריך ההשקעה');
    if (!investedOn) throw new Refuse('צריך תאריך השקעה');
    const value = optAmount(f, 'current_value', 'שווי נוכחי');
    let source = str(f, 'value_source'), valueDate = optDate(f, 'value_date', 'תאריך השווי');
    if (value !== null) {
      if (!source || !INV_SOURCES.includes(source)) throw new Refuse('בחר מקור לשווי');
      valueDate = valueDate ?? todayIL();
    } else { source = null; valueDate = null; }
    const ticker = str(f, 'ticker');
    if (ticker && !/^[A-Za-z0-9.\-:]{1,20}$/.test(ticker)) throw new Refuse('סימול: אותיות לועזיות, ספרות, נקודה או מקף');
    const notes = str(f, 'notes');
    if (tooLong(notes, 2000)) throw new Refuse('ההערות ארוכות מדי');
    const scope = scopeOf(f);
    if (!canCreateIn(u, { domain: 'ventures', branch: 'investments' }, 'money')) throw new Refuse('אין לך הרשאה להוסיף השקעות');
    return inTx(async c => {
      const { rows } = await c.query(
        `INSERT INTO investments (category, name, amount_invested, invested_on, current_value, value_date, value_source, ticker, notes, owner_user_id, scope, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10) RETURNING id`,
        [category, name, amount, investedOn, value, valueDate, source, ticker, notes, u.id, scope]);
      await log(c, u, 'investment', rows[0].id, 'create', { name, amount_invested: amount, current_value: value });
      return rows[0].id as string;
    });
  }, str(f, 'path'));
}

export async function updateInvestment(_: VenturesResult | null, f: FormData): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    const value = optAmount(f, 'current_value', 'שווי נוכחי');
    const source = str(f, 'value_source');
    const valueDate = optDate(f, 'value_date', 'תאריך השווי');
    if (value !== null && (!source || !INV_SOURCES.includes(source) || !valueDate)) throw new Refuse('שווי צריך מקור ותאריך');
    const status = str(f, 'status') ?? 'active';
    if (status !== 'active' && status !== 'exited') throw new Refuse('סטטוס לא תקין');
    const notes = str(f, 'notes');
    if (tooLong(notes, 2000)) throw new Refuse('ההערות ארוכות מדי');
    await inTx(async c => {
      const { row } = await loadSubject(c, u, 'investment', str(f, 'id'), true);
      await c.query(
        `UPDATE investments SET current_value = $2, value_date = $3, value_source = $4, status = $5, notes = $6, updated_at = now() WHERE id = $1`,
        [row.id, value, value === null ? null : valueDate, value === null ? null : source, status, notes]);
      await log(c, u, 'investment', row.id, 'update', { current_value: value, value_source: source, status });
    });
  }, str(f, 'path'));
}

export async function removeInvestment(id: string, path: string): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    await inTx(async c => {
      const { row } = await loadSubject(c, u, 'investment', id, true);
      if (!canDeleteRow(u, 'money', row)) throw new Refuse('אין הרשאה למחוק את ההשקעה');
      await c.query(`UPDATE investments SET deleted_at = now(), updated_at = now() WHERE id = $1`, [row.id]);
      await log(c, u, 'investment', row.id, 'delete');
    });
  }, path);
}

// ── Legal cases and deadlines ─────────────────────────────────────────────────
function caseFields(f: FormData) {
  const title = str(f, 'title');
  if (!title || title.length > 200) throw new Refuse('שם התיק: 1 עד 200 תווים');
  const status = str(f, 'status') ?? 'open';
  if (!['open', 'waiting', 'closed'].includes(status)) throw new Refuse('סטטוס לא תקין');
  const caseNumber = str(f, 'case_number'), court = str(f, 'court'), parties = str(f, 'parties'), lawyer = str(f, 'lawyer'), notes = str(f, 'notes');
  if (tooLong(caseNumber, 60) || tooLong(court, 120) || tooLong(parties, 500) || tooLong(lawyer, 120) || tooLong(notes, 4000)) throw new Refuse('אחד השדות ארוך מדי');
  const openedOn = optDate(f, 'opened_on', 'תאריך פתיחה');
  let closedOn = optDate(f, 'closed_on', 'תאריך סגירה');
  if (status === 'closed' && !closedOn) closedOn = todayIL();
  if (status !== 'closed') closedOn = null;
  if (openedOn && closedOn && closedOn < openedOn) throw new Refuse('תאריך הסגירה לפני הפתיחה');
  return { title, status, caseNumber, court, parties, lawyer, notes, openedOn, closedOn };
}

export async function addCase(_: VenturesResult | null, f: FormData): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    const x = caseFields(f);
    const scope = scopeOf(f);
    if (!canCreateIn(u, { domain: 'ventures', branch: 'legal-and-tasks' }, 'task')) throw new Refuse('אין לך הרשאה לפתוח תיק');
    const firstDeadline = optDate(f, 'deadline_on', 'מועד');
    const firstDeadlineTitle = str(f, 'deadline_title');
    if (tooLong(firstDeadlineTitle, 200)) throw new Refuse('שם המועד ארוך מדי');
    return inTx(async c => {
      const { rows } = await c.query(
        `INSERT INTO legal_cases (title, case_number, court, status, parties, lawyer, opened_on, closed_on, notes, owner_user_id, scope, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10) RETURNING id`,
        [x.title, x.caseNumber, x.court, x.status, x.parties, x.lawyer, x.openedOn, x.closedOn, x.notes, u.id, scope]);
      const id = rows[0].id as string;
      if (firstDeadline) {
        await c.query(`INSERT INTO case_deadlines (case_id, due_on, title, created_by) VALUES ($1, $2, $3, $4)`,
          [id, firstDeadline, firstDeadlineTitle ?? 'מועד', u.id]);
      }
      await log(c, u, 'legal_case', id, 'create', { title: x.title, status: x.status, deadline: firstDeadline });
      return id;
    });
  }, str(f, 'path'));
}

export async function updateCase(_: VenturesResult | null, f: FormData): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    const x = caseFields(f);
    await inTx(async c => {
      const { row } = await loadSubject(c, u, 'legal_case', str(f, 'id'), true);
      await c.query(
        `UPDATE legal_cases SET title = $2, case_number = $3, court = $4, status = $5, parties = $6, lawyer = $7, opened_on = $8,
           closed_on = $9, notes = $10, updated_at = now() WHERE id = $1`,
        [row.id, x.title, x.caseNumber, x.court, x.status, x.parties, x.lawyer, x.openedOn, x.closedOn, x.notes]);
      await log(c, u, 'legal_case', row.id, 'update', { status: x.status, from_status: row.status });
    });
  }, str(f, 'path'));
}

export async function removeCase(id: string, path: string): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    await inTx(async c => {
      const { row } = await loadSubject(c, u, 'legal_case', id, true);
      if (!canDeleteRow(u, 'task', row)) throw new Refuse('אין הרשאה למחוק את התיק');
      await c.query(`UPDATE legal_cases SET deleted_at = now(), updated_at = now() WHERE id = $1`, [row.id]);
      await log(c, u, 'legal_case', row.id, 'delete');
    });
  }, path);
}

export async function addDeadline(_: VenturesResult | null, f: FormData): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    const due = optDate(f, 'due_on', 'מועד');
    if (!due) throw new Refuse('צריך תאריך');
    const title = str(f, 'title');
    if (!title || title.length > 200) throw new Refuse('מה המועד: 1 עד 200 תווים');
    return inTx(async c => {
      const { row } = await loadSubject(c, u, 'legal_case', str(f, 'case_id'));
      const { rows } = await c.query(`INSERT INTO case_deadlines (case_id, due_on, title, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [row.id, due, title, u.id]);
      await log(c, u, 'case_deadline', rows[0].id, 'create', { case_id: row.id, due_on: due });
      return rows[0].id as string;
    });
  }, str(f, 'path'));
}

async function deadlineCase(c: PoolClient, u: SessionUser, id: string) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Refuse('בקשה לא תקינה');
  const { rows } = await c.query(`SELECT * FROM case_deadlines WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
  if (!rows[0]) throw new Refuse('המועד לא נמצא');
  const { row } = await loadSubject(c, u, 'legal_case', rows[0].case_id);
  return { d: rows[0], legalCase: row };
}

export async function toggleDeadline(id: string, path: string): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    await inTx(async c => {
      const { d } = await deadlineCase(c, u, id);
      await c.query(`UPDATE case_deadlines SET done_at = CASE WHEN done_at IS NULL THEN now() END WHERE id = $1`, [d.id]);
      await log(c, u, 'case_deadline', d.id, d.done_at ? 'reopen' : 'done', { case_id: d.case_id });
    });
  }, path);
}

export async function removeDeadline(id: string, path: string): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    await inTx(async c => {
      const { d } = await deadlineCase(c, u, id);
      await c.query(`UPDATE case_deadlines SET deleted_at = now() WHERE id = $1`, [d.id]);
      await log(c, u, 'case_deadline', d.id, 'delete', { case_id: d.case_id });
    });
  }, path);
}

// ── Tasks and contacts linked to an object ────────────────────────────────────
export async function addSubjectTask(_: VenturesResult | null, f: FormData): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    const title = str(f, 'title');
    if (!title || title.length > 300) throw new Refuse('שם המשימה: 1 עד 300 תווים');
    const due = optDate(f, 'due_date', 'תאריך יעד');
    const priority = Number(str(f, 'priority') ?? '3');
    if (![1, 2, 3, 4].includes(priority)) throw new Refuse('עדיפות לא תקינה');
    return inTx(async c => {
      const { type, row } = await loadSubject(c, u, str(f, 'subject_type'), str(f, 'subject_id'));
      const place = { domain: 'ventures', branch: row.branch, location: null };
      if (!canCreateIn(u, place, 'task')) throw new Refuse('אין לך הרשאה להוסיף משימות כאן');
      const { rows } = await c.query(
        `INSERT INTO work_items (domain, branch, category_id, title, priority, due_date, owner_user_id, scope, subject_type, subject_id)
         VALUES ('ventures', $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [row.branch, type === 'legal_case' ? 'legal' : 'finance', title, priority, due, u.id, row.scope, type, row.id]);
      await log(c, u, 'task', rows[0].id, 'create', { title, subject_type: type, subject_id: row.id });
      return rows[0].id as string;
    });
  }, str(f, 'path'));
}

export async function addContact(_: VenturesResult | null, f: FormData): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    const name = str(f, 'name');
    if (!name || name.length > 120) throw new Refuse('שם: 1 עד 120 תווים');
    const role = str(f, 'role');
    if (tooLong(role, 60)) throw new Refuse('התפקיד ארוך מדי');
    const phone = str(f, 'phone');
    if (phone && !/^[0-9+\-() ]{3,30}$/.test(phone)) throw new Refuse('טלפון: ספרות, רווחים, + או מקף');
    const email = str(f, 'email');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Refuse('אימייל לא תקין');
    const notes = str(f, 'notes');
    if (tooLong(notes, 1000)) throw new Refuse('ההערות ארוכות מדי');
    return inTx(async c => {
      const { type, row } = await loadSubject(c, u, str(f, 'subject_type'), str(f, 'subject_id'));
      if (!canCreateIn(u, { domain: 'ventures', branch: row.branch }, 'money') && !canCreateIn(u, { domain: 'ventures', branch: row.branch }, 'task')) {
        throw new Refuse('אין לך הרשאה להוסיף אנשי קשר כאן');
      }
      const { rows } = await c.query(
        `INSERT INTO contacts (domain, branch, name, role, phone, email, notes, owner_user_id, scope, created_by)
         VALUES ('ventures', $1, $2, $3, $4, $5, $6, $7, $8, $7) RETURNING id`,
        [row.branch, name, role, phone, email, notes, u.id, row.scope]);
      const id = rows[0].id as string;
      await c.query(`INSERT INTO contact_links (contact_id, subject_type, subject_id, created_by) VALUES ($1, $2, $3, $4)`, [id, type, row.id, u.id]);
      await log(c, u, 'contact', id, 'create', { name, subject_type: type, subject_id: row.id });
      return id;
    });
  }, str(f, 'path'));
}

export async function unlinkContact(linkId: string, path: string): Promise<VenturesResult> {
  return run(await currentUser(), async u => {
    if (typeof linkId !== 'string' || !UUID.test(linkId)) throw new Refuse('בקשה לא תקינה');
    await inTx(async c => {
      const { rows } = await c.query(`SELECT * FROM contact_links WHERE id = $1 AND deleted_at IS NULL`, [linkId]);
      if (!rows[0]) throw new Refuse('הקישור לא נמצא');
      await loadSubject(c, u, rows[0].subject_type, rows[0].subject_id);
      await c.query(`UPDATE contact_links SET deleted_at = now() WHERE id = $1`, [linkId]);
      await log(c, u, 'contact', rows[0].contact_id, 'unlink', { subject_type: rows[0].subject_type, subject_id: rows[0].subject_id });
    });
  }, path);
}
