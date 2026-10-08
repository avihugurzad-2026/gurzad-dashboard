import 'server-only';
import { db } from './db';
import { canCreateIn, canDeleteRow, canEditRow, params, visibleSql, type SessionUser } from './auth';
import type { WorkItem } from './entries';
import { categoryName, type Direction } from '@/lib/finance';
import { contextLabel } from '@/lib/places';
import { todayIL } from '@/lib/period';
import ventures, { type ScheduleRow, type Yields } from '@domain/ventures';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Stage 3.3 ventures: properties (assets) with their loans (liabilities), investments, legal cases.
// Every read goes through visibleSql: 'money' for assets/loans/investments/transactions, 'task' for
// cases and tasks. Missing tables (migration not applied) → ready:false. Missing numbers → null
// (shown as "אין נתונים עדיין"), never 0. Values marked as an estimate are labelled "הערכה".

const missing = (e: any) => e?.code === '42P01' || e?.code === '42703';
const r2 = ventures.round2;
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export type SubjectType = 'asset' | 'liability' | 'investment' | 'legal_case';
export type ValueSource = 'estimate' | 'appraisal' | 'purchase' | 'statement' | 'market';
export const VALUE_SOURCE_LABEL: Record<ValueSource, string> = {
  estimate: 'הערכה', appraisal: 'שמאות', purchase: 'מחיר רכישה', statement: 'דוח מהגוף המנהל', market: 'מחיר שוק',
};
export const ASSET_KINDS = [
  { id: 'apartment', label: 'דירה' }, { id: 'house', label: 'בית' }, { id: 'commercial', label: 'מסחרי' },
  { id: 'land', label: 'קרקע' }, { id: 'other', label: 'אחר' },
] as const;
export const INVESTMENT_CATEGORIES = [
  { id: 'stocks', label: 'מניות' }, { id: 'bonds', label: 'אג״ח' }, { id: 'fund', label: 'קרן / תיק מנוהל' },
  { id: 'pension', label: 'פנסיה / השתלמות' }, { id: 'deposit', label: 'פיקדון' }, { id: 'crypto', label: 'קריפטו' },
  { id: 'private', label: 'השקעה פרטית' }, { id: 'real-estate', label: 'נדל״ן (קרן / קבוצה)' }, { id: 'other', label: 'אחר' },
] as const;
export const CASE_STATUSES = [
  { id: 'open', label: 'פתוח' }, { id: 'waiting', label: 'ממתין' }, { id: 'closed', label: 'סגור' },
] as const;
export const labelIn = (list: readonly { id: string; label: string }[], id: string | null) => list.find(x => x.id === id)?.label ?? (id ?? '');

// ── Shared pieces (tasks, contacts, documents, transactions of one object) ────
export type Contact = { id: string; link_id: string; name: string; role: string | null; phone: string | null; email: string | null; notes: string | null };
export type DocumentRef = { id: string; title: string; doc_type: string; doc_date: string | null; file_id: string | null };
export type SubjectTx = {
  id: string; direction: Direction; occurred_on: string; amount_net: number; amount_gross: number; category: string; category_label: string;
  description: string | null; counterparty_name: string | null; subject_type: string; context: string; can_delete: boolean;
};

async function subjectTasks(u: SessionUser, type: SubjectType, ids: string[]): Promise<WorkItem[]> {
  if (!ids.length) return [];
  const q = params([type, ids]);
  const today = todayIL();
  const { rows } = await db().query(
    `SELECT w.id, w.title, w.description, w.priority, w.status, w.waiting_on, to_char(w.due_date, 'YYYY-MM-DD') AS due_date,
            to_char(w.due_time, 'HH24:MI') AS due_time, w.owner_user_id AS owner, w.category_id, w.domain, w.branch, w.location,
            w.completed_at, w.assigned_to, w.scope, w.event_id,
            CASE WHEN w.due_date < ${q.p(today)}::date AND w.status NOT IN ('done', 'cancelled') THEN (${q.p(today)}::date - w.due_date) END AS days_past
     FROM work_items w
     WHERE w.deleted_at IS NULL AND w.subject_type = $1 AND w.subject_id = ANY($2::uuid[]) AND ${visibleSql(u, 'task', 'w', q.p)}
     ORDER BY (w.status IN ('done', 'cancelled')), w.due_date NULLS LAST, w.priority, w.created_at`, q.values);
  return rows.map((r: any) => ({ ...r, source: 'dashboard', context: contextLabel(r, r.category_id) }));
}

async function subjectContacts(u: SessionUser, type: SubjectType, id: string): Promise<Contact[]> {
  const q = params([type, id]);
  const { rows } = await db().query(
    `SELECT c.id, l.id AS link_id, c.name, c.role, c.phone, c.email, c.notes
     FROM contact_links l JOIN contacts c ON c.id = l.contact_id
     WHERE l.deleted_at IS NULL AND c.deleted_at IS NULL AND l.subject_type = $1 AND l.subject_id = $2
       AND ${visibleSql(u, 'money', 'c', q.p)}
     ORDER BY c.name`, q.values);
  return rows;
}

// Documents belong to the documents work (3.4). Until its table exists this reads as an empty list.
async function subjectDocuments(u: SessionUser, type: SubjectType, id: string): Promise<{ ready: boolean; items: DocumentRef[] }> {
  const q = params([type, id]);
  try {
    const { rows } = await db().query(
      `SELECT d.id, d.title, d.doc_type, to_char(d.doc_date, 'YYYY-MM-DD') AS doc_date, v.file_id
       FROM documents d LEFT JOIN document_versions v ON v.document_id = d.id AND v.version = d.current_version
       WHERE d.deleted_at IS NULL AND d.subject_type = $1 AND d.subject_id = $2 AND ${visibleSql(u, 'money', 'd', q.p)}
       ORDER BY d.doc_date DESC NULLS LAST, d.created_at DESC LIMIT 50`, q.values);
    return { ready: true, items: rows };
  } catch (e) {
    if (!missing(e)) throw e;
    return { ready: false, items: [] };
  }
}

// Transactions about an object. For a property this includes the venture share of its loan repayments.
async function subjectTransactions(u: SessionUser, subjects: { type: SubjectType; ids: string[] }[], ventureOnly: boolean): Promise<SubjectTx[]> {
  const q = params();
  const ors = subjects.filter(s => s.ids.length).map(s => `(t.subject_type = ${q.p(s.type)} AND t.subject_id = ANY(${q.p(s.ids)}::uuid[]))`);
  if (!ors.length) return [];
  const { rows } = await db().query(
    `SELECT t.id, t.direction, to_char(t.occurred_on, 'YYYY-MM-DD') AS occurred_on, t.amount_gross::float AS amount_gross,
            (t.amount_gross - t.vat_amount)::float AS amount_net, t.category, t.description, t.counterparty_name, t.subject_type,
            t.domain, t.branch, t.location, t.owner_user_id, t.scope
     FROM transactions t
     WHERE t.deleted_at IS NULL AND (${ors.join(' OR ')}) ${ventureOnly ? `AND t.domain = 'ventures'` : ''}
       AND ${visibleSql(u, 'money', 't', q.p)}
     ORDER BY t.occurred_on DESC, t.created_at DESC LIMIT 200`, q.values);
  return rows.map((r: any) => ({
    id: r.id, direction: r.direction, occurred_on: r.occurred_on, amount_gross: r.amount_gross, amount_net: r.amount_net,
    category: r.category, category_label: categoryName(r.direction, r.category), description: r.description,
    counterparty_name: r.counterparty_name, subject_type: r.subject_type, context: contextLabel(r, null),
    // A loan repayment is undone from its loan (so the balance comes back), not deleted on its own
    can_delete: r.subject_type !== 'liability' && canDeleteRow(u, 'money', r),
  }));
}

const yearAgo = (today: string) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); };
function monthsBetween(from: string, to: string) {
  const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`);
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() + (b.getUTCDate() >= a.getUTCDate() ? 0 : -1));
}

// ── Properties ────────────────────────────────────────────────────────────────
export type Loan = {
  id: string; asset_id: string | null; kind: string; lender: string; principal: number; annual_rate: number; start_date: string;
  term_months: number; monthly_payment: number; balance: number; balance_date: string; venture_share_pct: number;
  status: 'active' | 'closed'; notes: string | null; owner_user_id: string; scope: 'user' | 'shared';
  months_to_payoff: number | null; can_edit: boolean;
};
export type LoanPayment = {
  id: string; liability_id: string; paid_on: string; amount: number; interest: number; principal: number;
  balance_before: number; balance_after: number; venture_share_pct: number; venture_amount: number; personal_amount: number; is_latest: boolean;
};
export type Property = {
  id: string; kind: string; name: string; address: string | null; purchase_date: string | null; purchase_cost: number | null;
  current_value: number | null; value_date: string | null; value_source: ValueSource | null; notes: string | null;
  owner_user_id: string; scope: 'user' | 'shared';
  loans_count: number; loan_balance: number | null;        // full balance of its active loans
  loan_balance_venture: number | null;                      // the venture's share of that balance
  loan_principal_venture: number | null;
  monthly_payment: number | null;                           // full monthly repayment
  equity_value: number | null;                              // current value − venture share of the balance
  income_12m: number | null; expenses_12m: number | null; interest_12m: number | null; principal_12m: number | null;
  repayments_12m: number;                                   // loan repayments recorded in the window
  months_of_data: number; yields: Yields;
};

const ASSET_COLS = `a.id, a.kind, a.name, a.address, to_char(a.purchase_date, 'YYYY-MM-DD') AS purchase_date, a.purchase_cost::float AS purchase_cost,
  a.current_value::float AS current_value, to_char(a.value_date, 'YYYY-MM-DD') AS value_date, a.value_source, a.notes,
  a.owner_user_id, a.scope, a.domain, a.branch, a.location`;

async function enrichProperties(u: SessionUser, assets: any[]): Promise<Property[]> {
  if (!assets.length) return [];
  const ids = assets.map(a => a.id);
  const today = todayIL();
  const from = yearAgo(today);
  const q = params([ids]);
  const lv = visibleSql(u, 'money', 'l', q.p);
  const [loans, money, paid] = await Promise.all([
    db().query(
      `SELECT l.asset_id, COUNT(*)::int AS n,
              SUM(l.balance)::float AS balance, SUM(l.balance * l.venture_share_pct / 100)::float AS balance_venture,
              SUM(l.principal * l.venture_share_pct / 100)::float AS principal_venture, SUM(l.monthly_payment)::float AS monthly
       FROM liabilities l WHERE l.deleted_at IS NULL AND l.status = 'active' AND l.asset_id = ANY($1::uuid[]) AND ${lv}
       GROUP BY 1`, q.values),
    (() => {
      const m = params([ids, from, today]);
      return db().query(
        `SELECT t.subject_id AS asset_id,
                SUM(t.amount_gross - t.vat_amount) FILTER (WHERE t.direction = 'income')::float AS income,
                SUM(t.amount_gross - t.vat_amount) FILTER (WHERE t.direction = 'expense')::float AS expenses,
                COUNT(*) FILTER (WHERE t.direction = 'income')::int AS n_income
         FROM transactions t
         WHERE t.deleted_at IS NULL AND t.subject_type = 'asset' AND t.subject_id = ANY($1::uuid[])
           AND t.occurred_on > $2::date AND t.occurred_on <= $3::date AND ${visibleSql(u, 'money', 't', m.p)}
         GROUP BY 1`, m.values);
    })(),
    (() => {
      const m = params([ids, from, today]);
      return db().query(
        `SELECT l.asset_id, SUM(p.interest * p.venture_share_pct / 100)::float AS interest,
                SUM(p.principal * p.venture_share_pct / 100)::float AS principal, COUNT(*)::int AS n
         FROM liability_payments p JOIN liabilities l ON l.id = p.liability_id
         WHERE p.deleted_at IS NULL AND l.deleted_at IS NULL AND l.asset_id = ANY($1::uuid[])
           AND p.paid_on > $2::date AND p.paid_on <= $3::date AND ${visibleSql(u, 'money', 'l', m.p)}
         GROUP BY 1`, m.values);
    })(),
  ]);
  const L = new Map(loans.rows.map((r: any) => [r.asset_id, r]));
  const M = new Map(money.rows.map((r: any) => [r.asset_id, r]));
  const P = new Map(paid.rows.map((r: any) => [r.asset_id, r]));
  return assets.map(a => {
    const l: any = L.get(a.id), m: any = M.get(a.id), p: any = P.get(a.id);
    const income = m?.n_income ? r2(m.income) : null;
    const expenses = m?.expenses != null ? r2(m.expenses) : null;
    const interest = p ? r2(p.interest) : null, principal = p ? r2(p.principal) : null;
    const loanPrincipal = l ? r2(l.principal_venture) : null;
    const balanceVenture = l ? r2(l.balance_venture) : null;
    const start = a.purchase_date && a.purchase_date > from ? a.purchase_date : from;
    return {
      id: a.id, kind: a.kind, name: a.name, address: a.address, purchase_date: a.purchase_date, purchase_cost: a.purchase_cost,
      current_value: a.current_value, value_date: a.value_date, value_source: a.value_source, notes: a.notes,
      owner_user_id: a.owner_user_id, scope: a.scope,
      loans_count: l?.n ?? 0, loan_balance: l ? r2(l.balance) : null, loan_balance_venture: balanceVenture,
      loan_principal_venture: loanPrincipal, monthly_payment: l ? r2(l.monthly) : null,
      equity_value: a.current_value === null ? null : r2(a.current_value - (balanceVenture ?? 0)),
      income_12m: income, expenses_12m: expenses, interest_12m: interest, principal_12m: principal,
      repayments_12m: p?.n ?? 0, months_of_data: Math.min(12, monthsBetween(start, today)),
      yields: ventures.propertyYields({
        purchase_cost: a.purchase_cost, loan_principal: loanPrincipal, income_12m: income,
        expenses_12m: expenses, interest_12m: interest, principal_12m: principal,
      }),
    };
  });
}

export async function listProperties(u: SessionUser): Promise<{ ready: boolean; items: Property[]; can_add: boolean }> {
  const can_add = canCreateIn(u, { domain: 'ventures', branch: 'real-estate' }, 'money');
  const q = params();
  try {
    const { rows } = await db().query(
      `SELECT ${ASSET_COLS} FROM assets a WHERE a.deleted_at IS NULL AND ${visibleSql(u, 'money', 'a', q.p)} ORDER BY a.created_at`, q.values);
    return { ready: true, items: await enrichProperties(u, rows), can_add };
  } catch (e) {
    if (!missing(e)) throw e;
    return { ready: false, items: [], can_add: false };
  }
}

const LOAN_COLS = `l.id, l.asset_id, l.kind, l.lender, l.principal::float AS principal, l.annual_rate::float AS annual_rate,
  to_char(l.start_date, 'YYYY-MM-DD') AS start_date, l.term_months, l.monthly_payment::float AS monthly_payment,
  l.balance::float AS balance, to_char(l.balance_date, 'YYYY-MM-DD') AS balance_date, l.venture_share_pct::float AS venture_share_pct,
  l.status, l.notes, l.owner_user_id, l.scope, l.domain, l.branch, l.location`;

export async function propertyDetail(u: SessionUser, id: string) {
  const q = params([id]);
  try {
    const { rows } = await db().query(
      `SELECT ${ASSET_COLS} FROM assets a WHERE a.id = $1 AND a.deleted_at IS NULL AND ${visibleSql(u, 'money', 'a', q.p)}`, q.values);
    if (!rows[0]) return null;
    const [property] = await enrichProperties(u, rows);
    const lq = params([id]);
    const { rows: loanRows } = await db().query(
      `SELECT ${LOAN_COLS} FROM liabilities l WHERE l.asset_id = $1 AND l.deleted_at IS NULL AND ${visibleSql(u, 'money', 'l', lq.p)}
       ORDER BY l.status, l.start_date`, lq.values);
    const loanIds = loanRows.map((l: any) => l.id);
    const { rows: payRows } = loanIds.length ? await db().query(
      `SELECT p.id, p.liability_id, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, p.amount::float AS amount, p.interest::float AS interest,
              p.principal::float AS principal, p.balance_before::float AS balance_before, p.balance_after::float AS balance_after,
              p.venture_share_pct::float AS venture_share_pct,
              (SELECT amount_gross::float FROM transactions WHERE id = p.venture_tx_id AND deleted_at IS NULL) AS venture_amount,
              (SELECT amount_gross::float FROM transactions WHERE id = p.personal_tx_id AND deleted_at IS NULL) AS personal_amount,
              p.created_at = MAX(p.created_at) OVER (PARTITION BY p.liability_id) AS is_latest
       FROM liability_payments p WHERE p.deleted_at IS NULL AND p.liability_id = ANY($1::uuid[])
       ORDER BY p.paid_on DESC, p.created_at DESC LIMIT 120`, [loanIds]) : { rows: [] as any[] };
    const loans: (Loan & { payments: LoanPayment[]; schedule: ScheduleRow[]; never_ends: boolean })[] = loanRows.map((l: any) => {
      const s = l.status === 'active' && l.balance > 0
        ? ventures.amortizationSchedule(l.balance, l.annual_rate, l.monthly_payment, 12, ventures.addMonths(l.balance_date, 1))
        : null;
      return {
        ...l, domain: undefined, branch: undefined, location: undefined,
        months_to_payoff: l.balance > 0 ? ventures.monthsToPayoff(l.balance, l.annual_rate, l.monthly_payment) : 0,
        can_edit: canEditRow(u, 'money', l),
        payments: payRows.filter((p: any) => p.liability_id === l.id).map((p: any) => ({
          ...p, venture_amount: p.venture_amount ?? 0, personal_amount: p.personal_amount ?? 0,
        })),
        schedule: s?.rows ?? [], never_ends: s?.never_ends ?? false,
      };
    });
    const [transactions, tasks, contacts, documents] = await Promise.all([
      subjectTransactions(u, [{ type: 'asset', ids: [id] }, { type: 'liability', ids: loanIds }], true),
      subjectTasks(u, 'asset', [id]),
      subjectContacts(u, 'asset', id),
      subjectDocuments(u, 'asset', id),
    ]);
    const row = rows[0];
    return {
      property, loans, transactions, tasks, contacts, documents,
      can_edit: canEditRow(u, 'money', row), can_delete: canDeleteRow(u, 'money', row),
    };
  } catch (e) {
    if (!missing(e)) throw e;
    return null;
  }
}
export type PropertyDetail = NonNullable<Awaited<ReturnType<typeof propertyDetail>>>;

// ── Investments ───────────────────────────────────────────────────────────────
export type Investment = {
  id: string; category: string; category_label: string; name: string; amount_invested: number; invested_on: string;
  current_value: number | null; value_date: string | null; value_source: ValueSource | null; ticker: string | null;
  quantity: number | null; status: 'active' | 'exited'; notes: string | null; owner_user_id: string; scope: 'user' | 'shared';
  gain: number | null; pct: number | null; annualized: number | null;
};
const INV_COLS = `i.id, i.category, i.name, i.amount_invested::float AS amount_invested, to_char(i.invested_on, 'YYYY-MM-DD') AS invested_on,
  i.current_value::float AS current_value, to_char(i.value_date, 'YYYY-MM-DD') AS value_date, i.value_source, i.ticker,
  i.quantity::float AS quantity, i.status, i.notes, i.owner_user_id, i.scope, i.domain, i.branch, i.location`;
const toInv = (r: any): Investment => {
  const ret = ventures.investmentReturn(r.amount_invested, r.current_value, r.invested_on, r.value_date);
  return { ...r, domain: undefined, branch: undefined, location: undefined, category_label: labelIn(INVESTMENT_CATEGORIES, r.category), ...ret };
};

export async function listInvestments(u: SessionUser) {
  const can_add = canCreateIn(u, { domain: 'ventures', branch: 'investments' }, 'money');
  const q = params();
  try {
    const { rows } = await db().query(
      `SELECT ${INV_COLS} FROM investments i WHERE i.deleted_at IS NULL AND ${visibleSql(u, 'money', 'i', q.p)}
       ORDER BY i.status, i.invested_on DESC`, q.values);
    const items = rows.map(toInv);
    const active = items.filter(i => i.status === 'active');
    const valued = active.filter(i => i.current_value !== null);
    const invested = active.length ? r2(active.reduce((s, i) => s + i.amount_invested, 0)) : null;
    const value = valued.length ? r2(valued.reduce((s, i) => s + (i.current_value as number), 0)) : null;
    const investedValued = valued.length ? r2(valued.reduce((s, i) => s + i.amount_invested, 0)) : null;
    const gain = value !== null && investedValued !== null ? r2(value - investedValued) : null;
    return {
      ready: true, items, can_add,
      totals: {
        invested, value, gain, pct: gain !== null && investedValued ? Math.round((gain / investedValued) * 100000) / 100000 : null,
        unvalued: active.length - valued.length, has_estimate: valued.some(i => i.value_source === 'estimate'),
      },
    };
  } catch (e) {
    if (!missing(e)) throw e;
    return { ready: false, items: [] as Investment[], can_add: false, totals: { invested: null, value: null, gain: null, pct: null, unvalued: 0, has_estimate: false } };
  }
}

export async function investmentDetail(u: SessionUser, id: string) {
  const q = params([id]);
  try {
    const { rows } = await db().query(
      `SELECT ${INV_COLS} FROM investments i WHERE i.id = $1 AND i.deleted_at IS NULL AND ${visibleSql(u, 'money', 'i', q.p)}`, q.values);
    if (!rows[0]) return null;
    const [transactions, tasks, contacts, documents] = await Promise.all([
      subjectTransactions(u, [{ type: 'investment', ids: [id] }], false),
      subjectTasks(u, 'investment', [id]),
      subjectContacts(u, 'investment', id),
      subjectDocuments(u, 'investment', id),
    ]);
    return {
      investment: toInv(rows[0]), transactions, tasks, contacts, documents,
      can_edit: canEditRow(u, 'money', rows[0]), can_delete: canDeleteRow(u, 'money', rows[0]),
    };
  } catch (e) {
    if (!missing(e)) throw e;
    return null;
  }
}
export type InvestmentDetail = NonNullable<Awaited<ReturnType<typeof investmentDetail>>>;

// ── Legal cases ───────────────────────────────────────────────────────────────
export type Deadline = { id: string; case_id: string; due_on: string; title: string; done_at: string | null; state: 'overdue' | 'soon' | 'later' | 'done' };
export type LegalCase = {
  id: string; title: string; case_number: string | null; court: string | null; status: 'open' | 'waiting' | 'closed';
  parties: string | null; lawyer: string | null; opened_on: string | null; closed_on: string | null; notes: string | null;
  owner_user_id: string; scope: 'user' | 'shared';
  next_deadline: Deadline | null; overdue_count: number; paid_total: number | null;
};
const CASE_COLS = `c.id, c.title, c.case_number, c.court, c.status, c.parties, c.lawyer, to_char(c.opened_on, 'YYYY-MM-DD') AS opened_on,
  to_char(c.closed_on, 'YYYY-MM-DD') AS closed_on, c.notes, c.owner_user_id, c.scope, c.domain, c.branch, c.location`;

async function deadlinesFor(ids: string[], today: string): Promise<Deadline[]> {
  if (!ids.length) return [];
  const { rows } = await db().query(
    `SELECT d.id, d.case_id, to_char(d.due_on, 'YYYY-MM-DD') AS due_on, d.title, d.done_at
     FROM case_deadlines d WHERE d.deleted_at IS NULL AND d.case_id = ANY($1::uuid[])
     ORDER BY (d.done_at IS NOT NULL), d.due_on, d.created_at`, [ids]);
  return rows.map((r: any) => ({ ...r, done_at: r.done_at ? new Date(r.done_at).toISOString() : null, state: ventures.deadlineState(r.due_on, r.done_at, today) }));
}

async function casePayments(u: SessionUser, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const q = params([ids]);
  const { rows } = await db().query(
    `SELECT t.subject_id, SUM(t.amount_gross)::float AS total FROM transactions t
     WHERE t.deleted_at IS NULL AND t.subject_type = 'legal_case' AND t.subject_id = ANY($1::uuid[]) AND t.direction = 'expense'
       AND ${visibleSql(u, 'money', 't', q.p)} GROUP BY 1`, q.values);
  return new Map(rows.map((r: any) => [r.subject_id, r2(r.total)]));
}

function toCase(r: any, deadlines: Deadline[], paid: Map<string, number>): LegalCase {
  const mine = deadlines.filter(d => d.case_id === r.id && !d.done_at);
  return {
    ...r, domain: undefined, branch: undefined, location: undefined,
    next_deadline: mine[0] ?? null, overdue_count: mine.filter(d => d.state === 'overdue').length, paid_total: paid.get(r.id) ?? null,
  };
}

export async function listCases(u: SessionUser) {
  const can_add = canCreateIn(u, { domain: 'ventures', branch: 'legal-and-tasks' }, 'task');
  const q = params();
  const today = todayIL();
  try {
    const { rows } = await db().query(
      `SELECT ${CASE_COLS} FROM legal_cases c WHERE c.deleted_at IS NULL AND ${visibleSql(u, 'task', 'c', q.p, { assigned: null })}
       ORDER BY (c.status = 'closed'), c.created_at DESC`, q.values);
    const ids = rows.map((r: any) => r.id);
    const [deadlines, paid] = await Promise.all([deadlinesFor(ids, today), casePayments(u, ids)]);
    const items = rows.map((r: any) => toCase(r, deadlines, paid));
    // Open cases with the nearest deadline first
    items.sort((a: LegalCase, b: LegalCase) => (a.status === 'closed' ? 1 : 0) - (b.status === 'closed' ? 1 : 0)
      || (a.next_deadline?.due_on ?? '9999').localeCompare(b.next_deadline?.due_on ?? '9999'));
    return { ready: true, items, can_add, today };
  } catch (e) {
    if (!missing(e)) throw e;
    return { ready: false, items: [] as LegalCase[], can_add: false, today };
  }
}

export async function caseDetail(u: SessionUser, id: string) {
  const q = params([id]);
  const today = todayIL();
  try {
    const { rows } = await db().query(
      `SELECT ${CASE_COLS} FROM legal_cases c WHERE c.id = $1 AND c.deleted_at IS NULL
         AND ${visibleSql(u, 'task', 'c', q.p, { assigned: null })}`, q.values);
    if (!rows[0]) return null;
    const [deadlines, paid, transactions, tasks, contacts, documents] = await Promise.all([
      deadlinesFor([id], today), casePayments(u, [id]),
      subjectTransactions(u, [{ type: 'legal_case', ids: [id] }], false),
      subjectTasks(u, 'legal_case', [id]),
      subjectContacts(u, 'legal_case', id),
      subjectDocuments(u, 'legal_case', id),
    ]);
    return {
      legalCase: toCase(rows[0], deadlines, paid), deadlines, transactions, tasks, contacts, documents, today,
      can_edit: canEditRow(u, 'task', rows[0]), can_delete: canDeleteRow(u, 'task', rows[0]),
      can_pay: canCreateIn(u, { domain: 'ventures', branch: 'legal-and-tasks' }, 'money'),
    };
  } catch (e) {
    if (!missing(e)) throw e;
    return null;
  }
}
export type CaseDetail = NonNullable<Awaited<ReturnType<typeof caseDetail>>>;

// ── Summary (ventures overview and the Home snapshot) ─────────────────────────
// Every number is null when there is nothing behind it. Values from an estimate set has_estimate.
export type VenturesSummary = {
  ready: boolean;
  properties: { count: number; value: number | null; unvalued: number; has_estimate: boolean };
  loans: { count: number; balance: number | null; balance_venture: number | null; monthly_payment: number | null };
  equity: number | null;                       // properties value − venture share of loan balances (valued properties only)
  investments: { count: number; invested: number | null; value: number | null; gain: number | null; has_estimate: boolean };
  legal: { open: number; overdue_deadlines: number; next_deadline: { case_id: string; case_title: string; due_on: string; title: string } | null };
  net_worth: number | null;                    // equity + investments value
};

export async function venturesSummary(u: SessionUser): Promise<VenturesSummary> {
  const [props, inv, cases] = await Promise.all([listProperties(u), listInvestments(u), listCases(u)]);
  const valued = props.items.filter(p => p.current_value !== null);
  const value = valued.length ? r2(valued.reduce((s, p) => s + (p.current_value as number), 0)) : null;
  const withLoans = props.items.filter(p => p.loan_balance !== null);
  const balance = withLoans.length ? r2(withLoans.reduce((s, p) => s + (p.loan_balance as number), 0)) : null;
  const balanceV = withLoans.length ? r2(withLoans.reduce((s, p) => s + (p.loan_balance_venture as number), 0)) : null;
  const monthly = withLoans.length ? r2(withLoans.reduce((s, p) => s + (p.monthly_payment as number), 0)) : null;
  const equity = valued.length ? r2(valued.reduce((s, p) => s + (p.equity_value as number), 0)) : null;
  const open = cases.items.filter(c => c.status !== 'closed');
  const next = open.filter(c => c.next_deadline).sort((a, b) => a.next_deadline!.due_on.localeCompare(b.next_deadline!.due_on))[0];
  const netWorth = equity === null && inv.totals.value === null ? null : r2((equity ?? 0) + (inv.totals.value ?? 0));
  return {
    ready: props.ready && inv.ready && cases.ready,
    properties: {
      count: props.items.length, value, unvalued: props.items.length - valued.length,
      has_estimate: valued.some(p => p.value_source === 'estimate'),
    },
    loans: { count: withLoans.reduce((s, p) => s + p.loans_count, 0), balance, balance_venture: balanceV, monthly_payment: monthly },
    equity,
    investments: {
      count: inv.items.filter(i => i.status === 'active').length, invested: inv.totals.invested, value: inv.totals.value,
      gain: inv.totals.gain, has_estimate: inv.totals.has_estimate,
    },
    legal: {
      open: open.length, overdue_deadlines: open.reduce((s, c) => s + c.overdue_count, 0),
      next_deadline: next ? { case_id: next.id, case_title: next.title, due_on: next.next_deadline!.due_on, title: next.next_deadline!.title } : null,
    },
    net_worth: netWorth,
  };
}
