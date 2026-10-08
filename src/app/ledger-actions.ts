'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { PoolClient } from 'pg';
import { currentUser, type SessionUser } from '@/server/auth';
import { db } from '@/server/db';
import { ledgerAccess, type Access } from '@/server/ledger';
import { loadWorkspaces, personalWorkspace, type WorkspaceRow } from '@/server/workspaces';
import { isIsoDate } from '@/lib/finance';
import { todayIL, dbDate } from '@/lib/period';
import money from '@domain/money';
import L from '@domain/ledger';

// Writes of the personal / household finance engine. Each action: session → ledgerAccess on the
// workspace (personal: its owner; household: its members, viewers read only) → validate → write
// (one DB transaction when several rows change) → activity_log → revalidate. Soft delete only.
// No amounts, categories or people are defined here: every value comes from the form.

export type LedgerResult = { ok: true; id?: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUR = /^[A-Z]{3}$/;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const NOT_READY = 'טבלאות הפיננסים עוד לא נוצרו במסד';
const tableMissing = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string })?.code ?? '');
class Refuse extends Error {}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
const bool = (f: FormData, k: string) => ['on', 'true', '1'].includes(String(f.get(k) ?? ''));
const uuid = (f: FormData, k: string) => { const v = str(f, k); return v && UUID.test(v) ? v : null; };
const len = (v: string | null, max: number) => !v || v.length <= max;
// A signed amount (balances may be negative): "-1,234.50" → -1234.5; empty → null; bad → NaN
const signed = (v: string | null): number | null => money.parseSigned(v);
const int = (v: string | null, min: number, max: number) => {
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};

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

async function log(c: PoolClient | null, u: SessionUser, type: string, id: string, action: string, meta: Record<string, unknown> = {}) {
  await (c ?? db()).query(`INSERT INTO activity_log (user_id, object_type, object_id, action, metadata_json) VALUES ($1, $2, $3, $4, $5)`,
    [u.id, type, id, action, JSON.stringify(meta)]);
}

function done(id?: string): LedgerResult {
  revalidatePath('/personal', 'layout');
  revalidatePath('/household', 'layout');
  return id ? { ok: true, id } : { ok: true };
}

// Session + write access to the workspace named in the form (`ws`)
type Fail = { ok: false; error: string };
async function writer(f: FormData | string | null): Promise<{ u: SessionUser; a: Access } | Fail> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  const ws = typeof f === 'string' || f === null ? f : str(f, 'ws');
  const a = await ledgerAccess(u, ws && UUID.test(ws) ? ws : null);
  if (!a) return fail('אין לך גישה לאזור הזה');
  if (!a.canWrite) return fail('יש לך הרשאת צפייה בלבד');
  return { u, a };
}
const isFail = <T extends object>(x: T | Fail): x is Fail => (x as Fail).ok === false;

// The place columns a ledger row carries for its workspace (the trigger derives workspace_id from them)
const placeOf = (w: WorkspaceRow) => w.kind === 'personal'
  ? { domain: 'personal', branch: null as string | null, scope: 'user' }
  : { domain: w.domain, branch: w.branch, scope: 'shared' };

async function ownRow(c: PoolClient, table: string, id: string, ws: string) {
  const { rows } = await c.query(`SELECT * FROM ${table} WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`, [id, ws]);
  return rows[0] ?? null;
}

async function categoryIn(c: PoolClient, ws: string, id: string | null, kind?: string) {
  if (!id) return null;
  const { rows } = await c.query(`SELECT id, key, kind, parent_id FROM transaction_categories WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`, [id, ws]);
  if (!rows[0] || (kind && rows[0].kind !== kind)) throw new Refuse('קטגוריה לא תקינה');
  return rows[0] as { id: string; key: string | null; kind: string; parent_id: string | null };
}
async function accountIn(c: PoolClient, ws: string, id: string | null) {
  if (!id) return null;
  const { rows } = await c.query(`SELECT id FROM financial_accounts WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`, [id, ws]);
  if (!rows[0]) throw new Refuse('חשבון לא תקין');
  return id;
}

async function guarded(fn: () => Promise<LedgerResult>): Promise<LedgerResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Refuse) return fail(e.message);
    if (tableMissing(e)) return fail(NOT_READY);
    if ((e as { code?: string })?.code === '23505') return fail('כבר קיים פריט כזה');
    if ((e as { code?: string })?.code === '23514') return fail('אחד הערכים לא תקין');
    unstable_rethrow(e);
    console.error(e);
    return fail('לא נשמר, נסה שוב');
  }
}

// ── Transactions ──────────────────────────────────────────────────────────────
const FREQ = new Set(['one_time', 'monthly', 'bimonthly', 'quarterly', 'yearly', 'custom']);

type TxInput = {
  direction: 'income' | 'expense'; occurred_on: string; amount: number; currency: string; merchant: string | null; description: string | null;
  category_id: string | null; subcategory_id: string | null; account_id: string | null; fixed_or_variable: 'fixed' | 'variable' | null;
  frequency: string | null; notes: string | null; source: string; document_id?: string | null; import_id?: string | null;
  recurring_expense_id?: string | null; dedupe_key?: string | null;
};

function readTx(f: FormData): TxInput | string {
  const direction = str(f, 'direction');
  if (direction !== 'income' && direction !== 'expense') return 'בחר הכנסה או הוצאה';
  const occurred = str(f, 'occurred_on');
  if (!isIsoDate(occurred)) return 'צריך תאריך תקין';
  const amount = money.parseAmount(str(f, 'amount'));
  if (amount === null) return 'סכום חייב להיות מספר חיובי (עד 2 ספרות אחרי הנקודה)';
  const currency = (str(f, 'currency') ?? 'ILS').toUpperCase();
  if (!CUR.test(currency)) return 'מטבע לא תקין';
  const merchant = str(f, 'merchant');
  if (!len(merchant, 120)) return 'שם בית העסק ארוך מדי';
  const description = str(f, 'description');
  if (!len(description, 500)) return 'התיאור ארוך מדי';
  const notes = str(f, 'notes');
  if (!len(notes, 1000)) return 'ההערה ארוכה מדי';
  const fv = str(f, 'fixed_or_variable');
  if (fv && fv !== 'fixed' && fv !== 'variable') return 'קבועה / משתנה לא תקין';
  const frequency = str(f, 'frequency');
  if (frequency && !FREQ.has(frequency)) return 'תדירות לא תקינה';
  if (!merchant && !description) return direction === 'income' ? 'כתוב ממי ההכנסה או תיאור' : 'כתוב בית עסק או תיאור';
  return {
    direction, occurred_on: occurred, amount, currency, merchant, description, notes,
    category_id: uuid(f, 'category_id'), subcategory_id: uuid(f, 'subcategory_id'), account_id: uuid(f, 'account_id'),
    fixed_or_variable: fv as TxInput['fixed_or_variable'], frequency, source: 'manual',
  };
}

// Insert one ledger row into workspace `w` (validated ids, legacy columns filled consistently)
async function insertTx(c: PoolClient, u: SessionUser, w: WorkspaceRow, t: TxInput): Promise<string> {
  const cat = await categoryIn(c, w.id, t.category_id, t.direction);
  const sub = await categoryIn(c, w.id, t.subcategory_id, t.direction);
  if (sub && cat && sub.parent_id !== cat.id) throw new Refuse('תת-קטגוריה לא שייכת לקטגוריה');
  await accountIn(c, w.id, t.account_id);
  const p = placeOf(w);
  const { rows } = await c.query(
    `INSERT INTO transactions (direction, occurred_on, amount_gross, currency, merchant, description, notes, category, category_id, subcategory_id,
        account_id, fixed_or_variable, frequency, source, document_id, import_id, recurring_expense_id, dedupe_key,
        classification, domain, branch, owner_user_id, scope, created_by, counterparty_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'personal', $19, $20, $21, $22, $21, $5)
     RETURNING id`,
    [t.direction, t.occurred_on, t.amount, t.currency, t.merchant, t.description, t.notes, cat?.key ?? 'other', cat?.id ?? null, sub?.id ?? null,
      t.account_id, t.fixed_or_variable, t.frequency, t.source, t.document_id ?? null, t.import_id ?? null, t.recurring_expense_id ?? null,
      t.dedupe_key ?? L.dedupeKey(t.occurred_on, t.amount, t.merchant ?? t.description ?? ''), p.domain, p.branch, u.id, p.scope]);
  return rows[0].id;
}

// "Remember this choice": a rule for this merchant → workspace / category / fixed / frequency
async function rememberRule(c: PoolClient, u: SessionUser, ws: string, merchant: string | null, t: Pick<TxInput, 'category_id' | 'subcategory_id' | 'fixed_or_variable' | 'frequency'>) {
  const pattern = L.normalizeMerchant(merchant);
  if (pattern.length < 2) return;
  const { rows } = await c.query(
    `SELECT id FROM categorization_rules WHERE owner_user_id = $1 AND deleted_at IS NULL AND match_field = 'merchant' AND match_type = 'contains' AND pattern = $2`,
    [u.id, pattern]);
  if (rows[0]) {
    await c.query(`UPDATE categorization_rules SET target_workspace_id = $2, category_id = $3, subcategory_id = $4, fixed_or_variable = $5, frequency = $6,
      active = true, updated_at = now() WHERE id = $1`, [rows[0].id, ws, t.category_id, t.subcategory_id, t.fixed_or_variable, t.frequency]);
  } else {
    await c.query(`INSERT INTO categorization_rules (owner_user_id, pattern, target_workspace_id, category_id, subcategory_id, fixed_or_variable, frequency)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [u.id, pattern, ws, t.category_id, t.subcategory_id, t.fixed_or_variable, t.frequency]);
  }
}

export async function saveTransaction(_: LedgerResult | null, f: FormData): Promise<LedgerResult> {
  const w0 = await writer(f);
  if (isFail(w0)) return w0;
  const { u, a } = w0;
  const t = readTx(f);
  if (typeof t === 'string') return fail(t);
  const id = uuid(f, 'id');
  return guarded(async () => {
    const out = await inTx(async c => {
      if (!id) {
        const nid = await insertTx(c, u, a.w, t);
        if (bool(f, 'remember')) await rememberRule(c, u, a.w.id, t.merchant, t);
        await log(c, u, 'transaction', nid, 'create', { ws: a.w.id, direction: t.direction, amount: t.amount });
        return nid;
      }
      const row = await ownRow(c, 'transactions', id, a.w.id);
      if (!row) throw new Refuse('התנועה לא נמצאה');
      if (row.source === 'contribution') throw new Refuse('העברה לבית משתנה מתוך לשונית ההעברות');
      if (a.w.kind === 'household' && row.owner_user_id !== u.id && !['owner', 'admin'].includes(a.role)) throw new Refuse('רק מי שרשם את התנועה או מנהל יכולים לערוך');
      const cat = await categoryIn(c, a.w.id, t.category_id, t.direction);
      const sub = await categoryIn(c, a.w.id, t.subcategory_id, t.direction);
      if (sub && cat && sub.parent_id !== cat.id) throw new Refuse('תת-קטגוריה לא שייכת לקטגוריה');
      await accountIn(c, a.w.id, t.account_id);
      await c.query(
        `UPDATE transactions SET direction = $2, occurred_on = $3, amount_gross = $4, currency = $5, merchant = $6, counterparty_name = $6, description = $7,
           notes = $8, category = $9, category_id = $10, subcategory_id = $11, account_id = $12, fixed_or_variable = $13, frequency = $14,
           dedupe_key = $15, updated_at = now() WHERE id = $1`,
        [id, t.direction, t.occurred_on, t.amount, t.currency, t.merchant, t.description, t.notes, cat?.key ?? 'other', cat?.id ?? null, sub?.id ?? null,
          t.account_id, t.fixed_or_variable, t.frequency, L.dedupeKey(t.occurred_on, t.amount, t.merchant ?? t.description ?? '')]);
      if (bool(f, 'remember')) await rememberRule(c, u, a.w.id, t.merchant, t);
      await log(c, u, 'transaction', id, 'update', { ws: a.w.id });
      return id;
    });
    return done(out);
  });
}

// Move a row between my personal area and a household I belong to (same row, new place)
export async function moveTransaction(id: string, fromWs: string, toWs: string): Promise<LedgerResult> {
  const w0 = await writer(fromWs);
  if (isFail(w0)) return w0;
  const { u, a } = w0;
  const to = await ledgerAccess(u, toWs);
  if (!to || !to.canWrite) return fail('אין לך גישה לאזור היעד');
  if (!UUID.test(id)) return fail('תנועה לא תקינה');
  return guarded(async () => {
    await inTx(async c => {
      const row = await ownRow(c, 'transactions', id, a.w.id);
      if (!row || row.owner_user_id !== u.id) throw new Refuse('אפשר להעביר רק תנועה שרשמת');
      if (row.source === 'contribution') throw new Refuse('העברה לבית לא עוברת בין אזורים');
      const p = placeOf(to.w);
      // Categories and accounts belong to a workspace: the moved row keeps its category by key
      const { rows: [cat] } = row.category_id
        ? await c.query(`SELECT t2.id FROM transaction_categories t1 JOIN transaction_categories t2 ON t2.key = t1.key AND t2.workspace_id = $2 AND t2.deleted_at IS NULL
                         WHERE t1.id = $1 AND t1.key IS NOT NULL LIMIT 1`, [row.category_id, to.w.id])
        : { rows: [] };
      await c.query(`UPDATE transactions SET domain = $2, branch = $3, scope = $4, category_id = $5, subcategory_id = NULL, account_id = NULL, updated_at = now() WHERE id = $1`,
        [id, p.domain, p.branch, p.scope, cat?.id ?? null]);
      await log(c, u, 'transaction', id, 'move', { from: a.w.id, to: to.w.id });
    });
    return done(id);
  });
}

export async function deleteTransaction(id: string, ws: string): Promise<LedgerResult> {
  const w0 = await writer(ws);
  if (isFail(w0)) return w0;
  const { u, a } = w0;
  if (!UUID.test(id)) return fail('תנועה לא תקינה');
  return guarded(async () => {
    await inTx(async c => {
      const row = await ownRow(c, 'transactions', id, a.w.id);
      if (!row) throw new Refuse('התנועה לא נמצאה');
      if (a.w.kind === 'household' && row.owner_user_id !== u.id && !['owner', 'admin'].includes(a.role)) throw new Refuse('רק מי שרשם את התנועה או מנהל יכולים למחוק');
      if (row.source === 'contribution') {
        await cancelPaymentFor(c, u, id);
      } else {
        await c.query(`UPDATE transactions SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id]);
      }
      await log(c, u, 'transaction', id, 'delete', { ws: a.w.id });
    });
    return done();
  });
}

// ── Accounts ──────────────────────────────────────────────────────────────────
const ACCOUNT_KINDS = new Set(['bank', 'credit_card', 'cash', 'savings', 'investment', 'loan', 'other']);

export async function saveAccount(_: LedgerResult | null, f: FormData): Promise<LedgerResult> {
  const w0 = await writer(f);
  if (isFail(w0)) return w0;
  const { u, a } = w0;
  const kind = str(f, 'kind');
  if (!kind || !ACCOUNT_KINDS.has(kind)) return fail('בחר סוג חשבון');
  const name = str(f, 'name');
  if (!name || name.length > 80) return fail('כתוב שם לחשבון (עד 80 תווים)');
  const institution = str(f, 'institution');
  if (!len(institution, 80)) return fail('שם הבנק / החברה ארוך מדי');
  const last4 = str(f, 'last4');
  if (last4 && !/^\d{4}$/.test(last4)) return fail('4 ספרות אחרונות בלבד (לעולם לא את המספר המלא)');
  const currency = (str(f, 'currency') ?? 'ILS').toUpperCase();
  if (!CUR.test(currency)) return fail('מטבע לא תקין');
  const opening = signed(str(f, 'opening_balance'));
  const balance = signed(str(f, 'balance'));
  if (Number.isNaN(opening) || Number.isNaN(balance)) return fail('יתרה חייבת להיות מספר');
  const asOf = str(f, 'balance_as_of');
  if (asOf && !isIsoDate(asOf)) return fail('תאריך יתרה לא תקין');
  const limit = signed(str(f, 'credit_limit'));
  if (limit !== null && (Number.isNaN(limit) || limit < 0)) return fail('מסגרת אשראי: מספר 0 ומעלה');
  const billing = int(str(f, 'billing_day'), 1, 31);
  if (Number.isNaN(billing)) return fail('יום חיוב בין 1 ל-31');
  const notes = str(f, 'notes');
  if (!len(notes, 1000)) return fail('ההערה ארוכה מדי');
  const id = uuid(f, 'id');
  const vals = [kind, name, institution, last4, currency, opening, balance, balance !== null ? asOf ?? todayIL() : null, limit, billing, notes];
  return guarded(async () => {
    const out = await inTx(async c => {
      if (id) {
        if (!(await ownRow(c, 'financial_accounts', id, a.w.id))) throw new Refuse('החשבון לא נמצא');
        await c.query(`UPDATE financial_accounts SET kind = $2, name = $3, institution = $4, last4 = $5, currency = $6, opening_balance = CASE WHEN $13 THEN $7 ELSE opening_balance END, balance = $8,
          balance_as_of = $9, credit_limit = $10, billing_day = $11, notes = $12, updated_at = now() WHERE id = $1`, [id, ...vals, f.has('opening_balance')]);
        await log(c, u, 'account', id, 'update', { ws: a.w.id });
        return id;
      }
      const { rows } = await c.query(`INSERT INTO financial_accounts (kind, name, institution, last4, currency, opening_balance, balance, balance_as_of, credit_limit,
        billing_day, notes, workspace_id, owner_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`, [...vals, a.w.id, u.id]);
      await log(c, u, 'account', rows[0].id, 'create', { ws: a.w.id, kind });
      return rows[0].id as string;
    });
    return done(out);
  });
}

export async function deleteAccount(id: string, ws: string): Promise<LedgerResult> {
  return softDelete('financial_accounts', 'account', id, ws);
}

async function softDelete(table: string, type: string, id: string, ws: string): Promise<LedgerResult> {
  const w0 = await writer(ws);
  if (isFail(w0)) return w0;
  const { u, a } = w0;
  if (!UUID.test(id)) return fail('פריט לא תקין');
  return guarded(async () => {
    const { rowCount } = await db().query(`UPDATE ${table} SET deleted_at = now() WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`, [id, a.w.id]);
    if (!rowCount) return fail('הפריט לא נמצא');
    await log(null, u, type, id, 'delete', { ws: a.w.id });
    return done();
  });
}

// ── Categories ────────────────────────────────────────────────────────────────
export async function saveCategory(_: LedgerResult | null, f: FormData): Promise<LedgerResult> {
  const w0 = await writer(f);
  if (isFail(w0)) return w0;
  const { u, a } = w0;
  const name = str(f, 'name');
  if (!name || name.length > 60) return fail('כתוב שם לקטגוריה (עד 60 תווים)');
  const kind = str(f, 'kind');
  if (kind !== 'income' && kind !== 'expense') return fail('הכנסה או הוצאה?');
  const parent = uuid(f, 'parent_id');
  const id = uuid(f, 'id');
  return guarded(async () => {
    const out = await inTx(async c => {
      if (parent) {
        const p = await categoryIn(c, a.w.id, parent, kind);
        if (p?.parent_id) throw new Refuse('אפשר רק שתי רמות: קטגוריה ותת-קטגוריה');
        if (id && id === parent) throw new Refuse('קטגוריה לא יכולה להיות תת-קטגוריה של עצמה');
        if (id) {
          const { rows: kids } = await c.query(`SELECT 1 FROM transaction_categories WHERE parent_id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
          if (kids.length) throw new Refuse('לקטגוריה הזו יש תת-קטגוריות, אז היא לא יכולה להיות תת-קטגוריה בעצמה');
        }
      }
      if (id) {
        if (!(await ownRow(c, 'transaction_categories', id, a.w.id))) throw new Refuse('הקטגוריה לא נמצאה');
        await c.query(`UPDATE transaction_categories SET name = $2, parent_id = $3 WHERE id = $1`, [id, name, parent]);
        await log(c, u, 'category', id, 'update', { ws: a.w.id, name });
        return id;
      }
      const { rows } = await c.query(`INSERT INTO transaction_categories (workspace_id, kind, name, parent_id, sort)
        VALUES ($1, $2, $3, $4, (SELECT coalesce(max(sort), 0) + 1 FROM transaction_categories WHERE workspace_id = $1)) RETURNING id`, [a.w.id, kind, name, parent]);
      await log(c, u, 'category', rows[0].id, 'create', { ws: a.w.id, name });
      return rows[0].id as string;
    });
    return done(out);
  });
}

export async function deleteCategory(id: string, ws: string): Promise<LedgerResult> {
  const r = await softDelete('transaction_categories', 'category', id, ws);
  if (r.ok) await db().query(`UPDATE transaction_categories SET deleted_at = now() WHERE parent_id = $1 AND deleted_at IS NULL`, [id]).catch(() => {});
  return r;
}

// ── Budget ────────────────────────────────────────────────────────────────────
// Fields `b_<category uuid>` = the month's budget for that category (empty = no line)
export async function saveBudget(_: LedgerResult | null, f: FormData): Promise<LedgerResult> {
  const w0 = await writer(f);
  if (isFail(w0)) return w0;
  const { u, a } = w0;
  const month = str(f, 'month');
  if (!month || !/^\d{4}-\d{2}$/.test(month) || !isIsoDate(`${month}-01`)) return fail('חודש לא תקין');
  const lines: [string, number][] = [];
  for (const [k, v] of f.entries()) {
    if (!k.startsWith('b_') || typeof v !== 'string' || v.trim() === '') continue;
    const cid = k.slice(2);
    if (!UUID.test(cid)) return fail('קטגוריה לא תקינה');
    const n = money.parseSigned(v);
    if (n === null || Number.isNaN(n) || n < 0) return fail('סכומי תקציב: מספר 0 ומעלה, עד 2 ספרות אחרי הנקודה');
    lines.push([cid, n]);
  }
  const notes = str(f, 'notes');
  if (!len(notes, 1000)) return fail('ההערה ארוכה מדי');
  return guarded(async () => {
    const id = await inTx(async c => {
      const { rows: [b] } = await c.query(
        `INSERT INTO budgets (workspace_id, month, notes, created_by) VALUES ($1, $2::date, $3, $4)
         ON CONFLICT (workspace_id, month) WHERE deleted_at IS NULL DO UPDATE SET notes = EXCLUDED.notes, updated_at = now() RETURNING id`,
        [a.w.id, `${month}-01`, notes, u.id]);
      await c.query(`DELETE FROM budget_categories WHERE budget_id = $1`, [b.id]);
      for (const [cid, amount] of lines) {
        await categoryIn(c, a.w.id, cid, 'expense');
        await c.query(`INSERT INTO budget_categories (budget_id, category_id, amount) VALUES ($1, $2, $3)`, [b.id, cid, amount]);
      }
      await log(c, u, 'budget', b.id, 'save', { ws: a.w.id, month, lines: lines.length });
      return b.id as string;
    });
    return done(id);
  });
}

// Copy a previous month's budget lines into `month` (only when `month` has no budget yet)
export async function copyBudget(ws: string, fromMonth: string, toMonth: string): Promise<LedgerResult> {
  const w0 = await writer(ws);
  if (isFail(w0)) return w0;
  const { u, a } = w0;
  if (![fromMonth, toMonth].every(m => /^\d{4}-\d{2}$/.test(m))) return fail('חודש לא תקין');
  return guarded(async () => {
    await inTx(async c => {
      const { rows: [src] } = await c.query(`SELECT id FROM budgets WHERE workspace_id = $1 AND month = $2::date AND deleted_at IS NULL`, [a.w.id, `${fromMonth}-01`]);
      if (!src) throw new Refuse('אין תקציב בחודש שממנו מעתיקים');
      const { rows: [b] } = await c.query(
        `INSERT INTO budgets (workspace_id, month, created_by) VALUES ($1, $2::date, $3) ON CONFLICT (workspace_id, month) WHERE deleted_at IS NULL DO NOTHING RETURNING id`,
        [a.w.id, `${toMonth}-01`, u.id]);
      if (!b) throw new Refuse('לחודש הזה כבר יש תקציב');
      await c.query(`INSERT INTO budget_categories (budget_id, category_id, amount) SELECT $1, category_id, amount FROM budget_categories WHERE budget_id = $2`, [b.id, src.id]);
      await log(c, u, 'budget', b.id, 'copy', { ws: a.w.id, from: fromMonth, to: toMonth });
    });
    return done();
  });
}

// ── Recurring expenses ────────────────────────────────────────────────────────
const REC_FREQ = new Set(['monthly', 'yearly', 'custom', 'one_time']);

export async function saveRecurring(_: LedgerResult | null, f: FormData): Promise<LedgerResult> {
  const w0 = await writer(f);
  if (isFail(w0)) return w0;
  const { u, a } = w0;
  const name = str(f, 'name');
  if (!name || name.length > 80) return fail('כתוב שם (עד 80 תווים)');
  const merchant = str(f, 'merchant');
  if (!len(merchant, 120)) return fail('שם בית העסק ארוך מדי');
  const amount = money.parseAmount(str(f, 'amount'));
  if (amount === null) return fail('סכום חייב להיות מספר חיובי');
  const currency = (str(f, 'currency') ?? 'ILS').toUpperCase();
  if (!CUR.test(currency)) return fail('מטבע לא תקין');
  const frequency = str(f, 'frequency');
  if (!frequency || !REC_FREQ.has(frequency)) return fail('בחר תדירות');
  const interval = frequency === 'custom' ? int(str(f, 'interval_months'), 1, 60) : null;
  if (frequency === 'custom' && (interval === null || Number.isNaN(interval))) return fail('כל כמה חודשים? (1 עד 60)');
  const start = str(f, 'start_date') ?? todayIL();
  if (!isIsoDate(start)) return fail('תאריך התחלה לא תקין');
  const end = str(f, 'end_date');
  if (end && (!isIsoDate(end) || end < start)) return fail('תאריך סיום לא תקין');
  const day = int(str(f, 'day_of_month'), 1, 31) ?? Number(start.slice(8, 10));
  if (Number.isNaN(day)) return fail('יום בחודש בין 1 ל-31');
  const status = str(f, 'status') ?? 'active';
  if (!['active', 'paused', 'ended'].includes(status)) return fail('סטטוס לא תקין');
  const notes = str(f, 'notes');
  if (!len(notes, 1000)) return fail('ההערה ארוכה מדי');
  const plan = { frequency, interval_months: interval, day_of_month: day, start_date: start, end_date: end, next_due: frequency === 'one_time' ? start : null };
  const nextDue = status === 'active' ? L.nextDue(plan, todayIL() < start ? start : todayIL()) : null;
  const id = uuid(f, 'id');
  return guarded(async () => {
    const out = await inTx(async c => {
      const cat = await categoryIn(c, a.w.id, uuid(f, 'category_id'), 'expense');
      const acc = await accountIn(c, a.w.id, uuid(f, 'account_id'));
      const vals = [name, merchant, amount, currency, cat?.id ?? null, acc, frequency, interval, day, nextDue, start, end, status, notes];
      if (id) {
        if (!(await ownRow(c, 'recurring_expenses', id, a.w.id))) throw new Refuse('ההוצאה הקבועה לא נמצאה');
        await c.query(`UPDATE recurring_expenses SET name = $2, merchant = $3, amount = $4, currency = $5, category_id = $6, account_id = $7, frequency = $8,
          interval_months = $9, day_of_month = $10, next_due = $11, start_date = $12, end_date = $13, status = $14, notes = $15, updated_at = now() WHERE id = $1`, [id, ...vals]);
        await log(c, u, 'recurring', id, 'update', { ws: a.w.id });
        return id;
      }
      const { rows } = await c.query(`INSERT INTO recurring_expenses (name, merchant, amount, currency, category_id, account_id, frequency, interval_months,
        day_of_month, next_due, start_date, end_date, status, notes, workspace_id, owner_user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`, [...vals, a.w.id, u.id]);
      await log(c, u, 'recurring', rows[0].id, 'create', { ws: a.w.id, frequency });
      return rows[0].id as string;
    });
    return done(out);
  });
}

export async function deleteRecurring(id: string, ws: string): Promise<LedgerResult> {
  return softDelete('recurring_expenses', 'recurring', id, ws);
}

// "שולם": records the occurrence as an expense (fixed) and moves next_due forward
export async function recordRecurring(_: LedgerResult | null, f: FormData): Promise<LedgerResult> {
  const w0 = await writer(f);
  if (isFail(w0)) return w0;
  const { u, a } = w0;
  const id = uuid(f, 'id');
  if (!id) return fail('פריט לא תקין');
  const on = str(f, 'occurred_on') ?? todayIL();
  if (!isIsoDate(on)) return fail('תאריך לא תקין');
  const amountIn = str(f, 'amount');
  const amount = amountIn ? money.parseAmount(amountIn) : null;
  if (amountIn && amount === null) return fail('סכום לא תקין');
  return guarded(async () => {
    await inTx(async c => {
      const r = await ownRow(c, 'recurring_expenses', id, a.w.id);
      if (!r) throw new Refuse('ההוצאה הקבועה לא נמצאה');
      const due = r.next_due ? dbDate(r.next_due) : on;
      const txId = await insertTx(c, u, a.w, {
        direction: 'expense', occurred_on: on, amount: amount ?? Number(r.amount), currency: r.currency, merchant: r.merchant ?? r.name, description: r.name,
        category_id: r.category_id, subcategory_id: null, account_id: r.account_id, fixed_or_variable: 'fixed',
        frequency: r.frequency === 'one_time' ? 'one_time' : r.frequency === 'yearly' ? 'yearly' : r.frequency === 'custom' ? 'custom' : 'monthly',
        notes: null, source: 'recurring', recurring_expense_id: id,
      });
      const next = L.advanceDue({ frequency: r.frequency, interval_months: r.interval_months, day_of_month: r.day_of_month, end_date: r.end_date ? dbDate(r.end_date) : null }, due);
      await c.query(`UPDATE recurring_expenses SET next_due = $2, status = CASE WHEN $2::date IS NULL THEN 'ended' ELSE status END, updated_at = now() WHERE id = $1`, [id, next]);
      await log(c, u, 'recurring', id, 'paid', { ws: a.w.id, tx: txId });
    });
    return done();
  });
}

// ── Savings goals ─────────────────────────────────────────────────────────────
export async function saveSavingsGoal(_: LedgerResult | null, f: FormData): Promise<LedgerResult> {
  const w0 = await writer(f);
  if (isFail(w0)) return w0;
  const { u, a } = w0;
  const name = str(f, 'name');
  if (!name || name.length > 80) return fail('כתוב שם ליעד (עד 80 תווים)');
  const target = money.parseAmount(str(f, 'target_amount'));
  if (target === null) return fail('סכום יעד חייב להיות מספר חיובי');
  const currentIn = str(f, 'current_amount');
  const current = currentIn ? signed(currentIn) : 0;
  if (current === null || Number.isNaN(current) || current < 0) return fail('כמה כבר נחסך: מספר 0 ומעלה');
  const deadline = str(f, 'deadline');
  if (deadline && !isIsoDate(deadline)) return fail('תאריך יעד לא תקין');
  const monthlyIn = str(f, 'monthly_contribution');
  const monthly = monthlyIn ? money.parseAmount(monthlyIn) : null;
  if (monthlyIn && monthly === null) return fail('הפקדה חודשית לא תקינה');
  const status = str(f, 'status') ?? 'active';
  if (!['active', 'reached', 'paused', 'dropped'].includes(status)) return fail('סטטוס לא תקין');
  const notes = str(f, 'notes');
  if (!len(notes, 1000)) return fail('ההערה ארוכה מדי');
  const id = uuid(f, 'id');
  return guarded(async () => {
    const out = await inTx(async c => {
      const acc = await accountIn(c, a.w.id, uuid(f, 'account_id'));
      const vals = [name, target, current, deadline, monthly, acc, status, notes];
      if (id) {
        if (!(await ownRow(c, 'savings_goals', id, a.w.id))) throw new Refuse('היעד לא נמצא');
        await c.query(`UPDATE savings_goals SET name = $2, target_amount = $3, current_amount = $4, deadline = $5, monthly_contribution = $6, account_id = $7,
          status = $8, notes = $9, updated_at = now() WHERE id = $1`, [id, ...vals]);
        await log(c, u, 'savings', id, 'update', { ws: a.w.id });
        return id;
      }
      const { rows } = await c.query(`INSERT INTO savings_goals (name, target_amount, current_amount, deadline, monthly_contribution, account_id, status, notes,
        workspace_id, owner_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [...vals, a.w.id, u.id]);
      await log(c, u, 'savings', rows[0].id, 'create', { ws: a.w.id });
      return rows[0].id as string;
    });
    return done(out);
  });
}

export async function deleteSavingsGoal(id: string, ws: string): Promise<LedgerResult> {
  return softDelete('savings_goals', 'savings', id, ws);
}

// Deposit (or withdraw, with a negative amount) into a goal; reaching the target marks it reached
export async function depositSavings(_: LedgerResult | null, f: FormData): Promise<LedgerResult> {
  const w0 = await writer(f);
  if (isFail(w0)) return w0;
  const { u, a } = w0;
  const id = uuid(f, 'id');
  if (!id) return fail('יעד לא תקין');
  const amount = signed(str(f, 'amount'));
  if (amount === null || Number.isNaN(amount) || amount === 0) return fail('כתוב סכום (שלילי למשיכה)');
  return guarded(async () => {
    await inTx(async c => {
      const g = await ownRow(c, 'savings_goals', id, a.w.id);
      if (!g) throw new Refuse('היעד לא נמצא');
      const next = L.round2(Number(g.current_amount) + amount);
      if (next < 0) throw new Refuse('אי אפשר למשוך יותר ממה שנחסך');
      await c.query(`UPDATE savings_goals SET current_amount = $2, status = CASE WHEN $2 >= target_amount AND status = 'active' THEN 'reached' ELSE status END,
        updated_at = now() WHERE id = $1`, [id, next]);
      await log(c, u, 'savings', id, amount > 0 ? 'deposit' : 'withdraw', { ws: a.w.id, amount });
    });
    return done();
  });
}

// ── Contributions (personal → household, a linked transfer) ───────────────────
// A member manages their own plan. The percentage and the source account stay private: the
// household reads only the amount, the date and the status.
export async function saveContribution(_: LedgerResult | null, f: FormData): Promise<LedgerResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  const hh = await ledgerAccess(u, uuid(f, 'household'));
  if (!hh || hh.w.kind !== 'household') return fail('בחר משק בית');
  if (!hh.canWrite) return fail('יש לך הרשאת צפייה בלבד');
  const mine = await personalWorkspace(u);
  if (!mine) return fail('לא נמצא האזור האישי שלך');
  const rule = str(f, 'rule');
  if (rule !== 'fixed' && rule !== 'percentage' && rule !== 'manual') return fail('בחר איך מחושב הסכום');
  const amountIn = str(f, 'amount');
  const amount = amountIn ? money.parseAmount(amountIn) : null;
  if (rule === 'fixed' && amount === null) return fail('כתוב סכום חודשי');
  if (amountIn && amount === null) return fail('סכום לא תקין');
  const pctIn = str(f, 'percentage');
  const pct = pctIn ? money.parseNumber(pctIn) : null;
  if (rule === 'percentage' && (pct === null || !(pct > 0 && pct <= 100))) return fail('אחוז בין 0 ל-100');
  if (pct !== null && !Number.isFinite(pct)) return fail('אחוז לא תקין');
  const frequency = str(f, 'frequency') ?? 'monthly';
  if (!['monthly', 'one_time', 'custom'].includes(frequency)) return fail('תדירות לא תקינה');
  const day = int(str(f, 'day_of_month'), 1, 28) ?? 1;
  if (Number.isNaN(day)) return fail('יום ההעברה בין 1 ל-28');
  const start = str(f, 'start_date') ?? todayIL();
  if (!isIsoDate(start)) return fail('תאריך התחלה לא תקין');
  const end = str(f, 'end_date');
  if (end && (!isIsoDate(end) || end < start)) return fail('תאריך סיום לא תקין');
  const status = str(f, 'status') ?? 'active';
  if (!['active', 'paused', 'ended'].includes(status)) return fail('סטטוס לא תקין');
  const auto = str(f, 'auto_or_manual') === 'auto' ? 'auto' : 'manual';
  const id = uuid(f, 'id');
  return guarded(async () => {
    const out = await inTx(async c => {
      const src = await accountIn(c, mine.id, uuid(f, 'source_account_id'));
      const vals = [rule, rule === 'percentage' ? null : amount, rule === 'percentage' ? pct : null, frequency, day, start, end, status, auto, src];
      if (id) {
        const { rows: [row] } = await c.query(`SELECT id FROM household_contributions WHERE id = $1 AND user_id = $2 AND workspace_id = $3 AND deleted_at IS NULL`, [id, u.id, hh.w.id]);
        if (!row) throw new Refuse('ההעברה לא נמצאה');
        await c.query(`UPDATE household_contributions SET rule = $2, amount = $3, percentage = $4, frequency = $5, day_of_month = $6, start_date = $7, end_date = $8,
          status = $9, auto_or_manual = $10, source_account_id = $11, updated_at = now() WHERE id = $1`, [id, ...vals]);
        await log(c, u, 'contribution', id, 'update', { ws: hh.w.id, status });
        return id;
      }
      const { rows } = await c.query(`INSERT INTO household_contributions (rule, amount, percentage, frequency, day_of_month, start_date, end_date, status, auto_or_manual,
        source_account_id, workspace_id, user_id, personal_workspace_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [...vals, hh.w.id, u.id, mine.id]);
      await log(c, u, 'contribution', rows[0].id, 'create', { ws: hh.w.id, rule });
      return rows[0].id as string;
    });
    return done(out);
  });
}

export async function endContribution(id: string): Promise<LedgerResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  if (!UUID.test(id)) return fail('פריט לא תקין');
  return guarded(async () => {
    const { rowCount } = await db().query(
      `UPDATE household_contributions SET status = 'ended', end_date = coalesce(end_date, $3::date), updated_at = now()
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, [id, u.id, todayIL()]);
    if (!rowCount) return fail('ההעברה לא נמצאה');
    await log(null, u, 'contribution', id, 'end');
    return done();
  });
}

// What a percentage plan asks for this month: computed on the personal side only
async function privateIncome(c: PoolClient, personalWs: string, period: string): Promise<number | null> {
  const { rows: [r] } = await c.query(
    `SELECT SUM(amount_gross)::float AS total FROM transactions WHERE workspace_id = $1 AND deleted_at IS NULL AND direction = 'income'
       AND occurred_on >= $2::date AND occurred_on < ($2::date + interval '1 month')`, [personalWs, period]);
  return r.total;
}

// "בצע העברה": −X on my personal side (transfer out), +X household income (contribution), linked
export async function executeContribution(_: LedgerResult | null, f: FormData): Promise<LedgerResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  const id = uuid(f, 'id');
  if (!id) return fail('פריט לא תקין');
  const on = str(f, 'paid_on') ?? todayIL();
  if (!isIsoDate(on)) return fail('תאריך לא תקין');
  const period = `${(str(f, 'period') ?? on).slice(0, 7)}-01`;
  if (!isIsoDate(period)) return fail('חודש לא תקין');
  const amountIn = str(f, 'amount');
  const typed = amountIn ? money.parseAmount(amountIn) : null;
  if (amountIn && typed === null) return fail('סכום לא תקין');
  return guarded(async () => {
    const out = await inTx(async c => {
      const { rows: [plan] } = await c.query(
        `SELECT * FROM household_contributions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`, [id, u.id]);
      if (!plan) throw new Refuse('ההעברה לא נמצאה');
      if (plan.status === 'ended') throw new Refuse('ההעברה הזו הסתיימה');
      const hh = await ledgerAccess(u, plan.workspace_id);
      if (!hh || !hh.canWrite) throw new Refuse('אין לך הרשאה לרשום העברה למשק הבית הזה');
      const mine = (await loadWorkspaces()).find(w => w.id === plan.personal_workspace_id && w.owner_user_id === u.id);
      if (!mine) throw new Refuse('לא נמצא האזור האישי שלך');
      const income = plan.rule === 'percentage' ? await privateIncome(c, mine.id, period) : null;
      const amount = typed ?? L.contributionDue(plan, income);
      if (!amount) throw new Refuse(plan.rule === 'percentage' ? 'אין עדיין הכנסות החודש לחשב מהן אחוז. כתוב סכום.' : 'כתוב סכום');
      const { rows: [hhCat] } = await c.query(`SELECT id FROM transaction_categories WHERE workspace_id = $1 AND key = 'contribution' AND deleted_at IS NULL LIMIT 1`, [hh.w.id]);
      const label = `העברה למשק הבית · ${hh.w.name}`;
      const personalTx = await c.query(
        `INSERT INTO transactions (direction, flow, occurred_on, amount_gross, currency, merchant, description, category, account_id, source,
           classification, domain, branch, owner_user_id, scope, created_by)
         VALUES ('transfer', 'out', $1, $2, 'ILS', $3, $3, 'other', $4, 'contribution', 'personal', 'personal', NULL, $5, 'user', $5) RETURNING id`,
        [on, amount, label, plan.source_account_id, u.id]);
      const p = placeOf(hh.w);
      const householdTx = await c.query(
        `INSERT INTO transactions (direction, occurred_on, amount_gross, currency, merchant, description, category, category_id, account_id, source,
           classification, domain, branch, owner_user_id, scope, created_by, linked_transaction_id)
         VALUES ('income', $1, $2, 'ILS', $3, 'העברה למשק הבית', 'contribution', $4, $5, 'contribution', 'personal', $6, $7, $8, 'shared', $8, $9) RETURNING id`,
        [on, amount, u.name, hhCat?.id ?? null, plan.target_account_id, p.domain, p.branch, u.id, personalTx.rows[0].id]);
      await c.query(`UPDATE transactions SET linked_transaction_id = $2 WHERE id = $1`, [personalTx.rows[0].id, householdTx.rows[0].id]);
      const { rows: [pay] } = await c.query(
        `INSERT INTO household_contribution_payments (contribution_id, workspace_id, user_id, period, amount, status, paid_on, personal_transaction_id, household_transaction_id, created_by)
         VALUES ($1, $2, $3, $4, $5, 'received', $6, $7, $8, $3) RETURNING id`,
        [id, hh.w.id, u.id, period, amount, on, personalTx.rows[0].id, householdTx.rows[0].id]);
      await log(c, u, 'contribution', id, 'paid', { ws: hh.w.id, payment: pay.id, amount });
      return pay.id as string;
    });
    return done(out);
  });
}

// Undo a contribution payment: both linked rows are soft-deleted, the payment is cancelled
async function cancelPaymentFor(c: PoolClient, u: SessionUser, txId: string) {
  const { rows: [pay] } = await c.query(
    `SELECT id, user_id, personal_transaction_id, household_transaction_id FROM household_contribution_payments
     WHERE (personal_transaction_id = $1 OR household_transaction_id = $1) AND status <> 'cancelled'`, [txId]);
  if (!pay) {
    await c.query(`UPDATE transactions SET deleted_at = now() WHERE id = $1 OR linked_transaction_id = $1`, [txId]);
    return;
  }
  if (pay.user_id !== u.id) throw new Refuse('רק מי שהעביר יכול לבטל את ההעברה');
  await c.query(`UPDATE household_contribution_payments SET status = 'cancelled' WHERE id = $1`, [pay.id]);
  await c.query(`UPDATE transactions SET deleted_at = now(), updated_at = now() WHERE id = ANY($1::uuid[])`,
    [[pay.personal_transaction_id, pay.household_transaction_id].filter(Boolean)]);
}

export async function cancelContributionPayment(paymentId: string): Promise<LedgerResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  if (!UUID.test(paymentId)) return fail('פריט לא תקין');
  return guarded(async () => {
    await inTx(async c => {
      const { rows: [p] } = await c.query(`SELECT personal_transaction_id, household_transaction_id, user_id FROM household_contribution_payments WHERE id = $1 AND status <> 'cancelled'`, [paymentId]);
      if (!p || p.user_id !== u.id) throw new Refuse('ההעברה לא נמצאה');
      if (p.personal_transaction_id) await cancelPaymentFor(c, u, p.personal_transaction_id);
      else await c.query(`UPDATE household_contribution_payments SET status = 'cancelled' WHERE id = $1`, [paymentId]);
      await log(c, u, 'contribution_payment', paymentId, 'cancel');
    });
    return done();
  });
}

// ── Categorization rules (owner-only) ─────────────────────────────────────────
export async function saveRule(_: LedgerResult | null, f: FormData): Promise<LedgerResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  const target = await ledgerAccess(u, uuid(f, 'target_workspace_id'));
  if (!target || !target.canWrite) return fail('בחר לאן לשייך');
  const pattern = str(f, 'pattern');
  if (!pattern || pattern.length < 2 || pattern.length > 120) return fail('כתוב מילה לזיהוי (2 עד 120 תווים)');
  const field = str(f, 'match_field') ?? 'merchant';
  if (!['merchant', 'description'].includes(field)) return fail('שדה לא תקין');
  const type = str(f, 'match_type') ?? 'contains';
  if (!['contains', 'equals', 'starts_with'].includes(type)) return fail('סוג התאמה לא תקין');
  const fv = str(f, 'fixed_or_variable');
  if (fv && fv !== 'fixed' && fv !== 'variable') return fail('קבועה / משתנה לא תקין');
  const frequency = str(f, 'frequency');
  if (frequency && !FREQ.has(frequency)) return fail('תדירות לא תקינה');
  const priority = int(str(f, 'priority'), 1, 1000) ?? 100;
  if (Number.isNaN(priority)) return fail('עדיפות 1 עד 1000');
  const id = uuid(f, 'id');
  return guarded(async () => {
    const out = await inTx(async c => {
      const cat = await categoryIn(c, target.w.id, uuid(f, 'category_id'));
      const sub = await categoryIn(c, target.w.id, uuid(f, 'subcategory_id'));
      const vals = [field, type, pattern, target.w.id, cat?.id ?? null, sub?.id ?? null, fv, frequency, priority, !str(f, 'inactive')];
      if (id) {
        const { rowCount } = await c.query(`UPDATE categorization_rules SET match_field = $3, match_type = $4, pattern = $5, target_workspace_id = $6, category_id = $7,
          subcategory_id = $8, fixed_or_variable = $9, frequency = $10, priority = $11, active = $12, updated_at = now()
          WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`, [id, u.id, ...vals]);
        if (!rowCount) throw new Refuse('הכלל לא נמצא');
        await log(c, u, 'rule', id, 'update');
        return id;
      }
      const { rows } = await c.query(`INSERT INTO categorization_rules (owner_user_id, match_field, match_type, pattern, target_workspace_id, category_id, subcategory_id,
        fixed_or_variable, frequency, priority, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`, [u.id, ...vals]);
      await log(c, u, 'rule', rows[0].id, 'create');
      return rows[0].id as string;
    });
    return done(out);
  });
}

export async function deleteRule(id: string): Promise<LedgerResult> {
  const u = await currentUser();
  if (!u) return fail('לא מחובר');
  if (!UUID.test(id)) return fail('פריט לא תקין');
  return guarded(async () => {
    const { rowCount } = await db().query(`UPDATE categorization_rules SET deleted_at = now() WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`, [id, u.id]);
    if (!rowCount) return fail('הכלל לא נמצא');
    await log(null, u, 'rule', id, 'delete');
    return done();
  });
}
