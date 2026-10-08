import 'server-only';
import { db } from './db';
import { canDeleteRow, canEditRow, canSeePlace, params, visibleSql, type SessionUser } from './auth';
import { finance as vaultFinance } from './data';
import { addDays, periodBounds, todayIL } from '@/lib/period';
import { contextLabel, type Place } from '@/lib/places';
import { categoryName, type Classification, type Direction, type VatRateRow } from '@/lib/finance';
import money from '@domain/money';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Stage 2.3 finance and 2.4 collections. Every read goes through visibleSql(…, 'money', …), so the
// database decides which rows a user sees. Missing tables (migration not applied) → ready:false.
// No data → null (shown as "אין נתונים עדיין"), never 0.

const missing = (e: any) => e?.code === '42P01' || e?.code === '42703';
const r2 = money.round2;

export type Split = { user_id: string; share_pct: number };
export type Transaction = {
  id: string; direction: Direction; occurred_on: string; amount_gross: number; currency: string; vat_included: boolean;
  vat_rate: number | null; vat_amount: number; amount_net: number; category: string; category_label: string;
  description: string | null; document_type: string; document_number: string | null;
  counterparty_name: string | null; counterparty_tax_id: string | null; payment_method: string | null; payment_date: string | null;
  classification: Classification; domain: string; branch: string | null; location: string | null; context: string;
  file_id: string | null; file_name: string | null; receivable_id: string | null; owner_user_id: string; scope: 'user' | 'shared';
  created_by: string | null; splits: Split[]; can_delete: boolean;
};

export const TX_SELECT = `
  t.id, t.direction, to_char(t.occurred_on, 'YYYY-MM-DD') AS occurred_on, t.amount_gross::float AS amount_gross, coalesce(t.currency, 'ILS') AS currency,
  t.vat_included, t.vat_rate::float AS vat_rate, t.vat_amount::float AS vat_amount, t.category, t.description,
  t.document_type, t.document_number, t.counterparty_name, t.counterparty_tax_id, t.payment_method,
  to_char(t.payment_date, 'YYYY-MM-DD') AS payment_date, t.classification, t.domain, t.branch, t.location,
  t.file_id, f.name AS file_name, t.receivable_id,
  EXISTS (SELECT 1 FROM receivables rv WHERE rv.id = t.receivable_id AND rv.deleted_at IS NULL) AS from_open_receivable, t.owner_user_id, t.scope, t.created_by, t.created_at,
  COALESCE((SELECT json_agg(json_build_object('user_id', s.user_id, 'share_pct', s.share_pct::float) ORDER BY s.user_id)
            FROM transaction_splits s WHERE s.transaction_id = t.id), '[]'::json) AS splits`;

function toTx(u: SessionUser, r: any): Transaction {
  return {
    ...r, file_name: r.file_name ?? null, created_at: undefined, from_open_receivable: undefined,
    amount_net: r2(r.amount_gross - r.vat_amount),
    category_label: categoryName(r.direction, r.category),
    context: contextLabel(r, null),
    can_delete: canDeleteRow(u, 'money', r) && !r.from_open_receivable,
  };
}

// AND-clause for a place: a domain-only place covers all its entities
export function placeSql(place: Partial<Place> | null | undefined, alias: string, p: (v: unknown) => string): string {
  if (!place?.domain) return 'TRUE';
  const parts = [`${alias}.domain = ${p(place.domain)}`];
  if (place.branch) parts.push(`${alias}.branch = ${p(place.branch)}`);
  if (place.location) parts.push(`${alias}.location = ${p(place.location)}`);
  return parts.join(' AND ');
}

// Dated VAT rows for the forms' live preview (never a constant)
export async function vatRateRows(): Promise<VatRateRow[]> {
  const { rows } = await db().query(
    `SELECT to_char(effective_from, 'YYYY-MM-DD') AS "from", (value->>'rate')::float AS rate
     FROM parameters WHERE key = 'vat_rate' AND jsonb_typeof(value->'rate') = 'number' ORDER BY effective_from`);
  return rows as VatRateRow[];
}

// ── Summary for a period ──────────────────────────────────────────────────────
type Amounts = { gross: number; net: number; vat: number };
type Maybe = Amounts | null;
const add = (a: Maybe, gross: number, vat: number): Amounts =>
  ({ gross: r2((a?.gross ?? 0) + gross), vat: r2((a?.vat ?? 0) + vat), net: r2((a?.net ?? 0) + gross - vat) });

export type FinanceFilter = {
  from: string; to: string; place?: Partial<Place> | null; classification?: Classification | null; direction?: Direction | null;
};

export async function financeSummary(u: SessionUser, f: FinanceFilter) {
  const q = params([f.from, f.to]);
  const where = [
    't.deleted_at IS NULL', 't.occurred_on BETWEEN $1::date AND $2::date',
    // A transfer (e.g. a contribution to the household) is money moving between two of your own
    // books: its other side is already an income row there, so it is neither income nor expense here
    `t.direction IN ('income', 'expense')`,
    visibleSql(u, 'money', 't', q.p), placeSql(f.place, 't', q.p),
  ];
  if (f.classification) where.push(`t.classification = ${q.p(f.classification)}`);
  const base = where.join(' AND ');
  const listWhere = f.direction ? `${base} AND t.direction = ${q.p(f.direction)}` : base;
  const LIMIT = 500;
  try {
    const [{ rows: groups }, { rows: list }] = await Promise.all([
      db().query(
        `SELECT t.direction, t.classification, t.category, t.domain, t.branch, t.location,
                SUM(t.amount_gross)::float AS gross, SUM(t.vat_amount)::float AS vat, COUNT(*)::int AS n
         FROM transactions t WHERE ${base} AND coalesce(t.currency, 'ILS') = 'ILS'
         GROUP BY 1, 2, 3, 4, 5, 6`, q.values.slice(0, q.values.length - (f.direction ? 1 : 0))),
      db().query(
        `SELECT ${TX_SELECT} FROM transactions t LEFT JOIN files f ON f.id = t.file_id
         WHERE ${listWhere} ORDER BY t.occurred_on DESC, t.created_at DESC LIMIT ${LIMIT + 1}`, q.values),
    ]);

    let income: Maybe = null, expense: Maybe = null;
    const byClass = new Map<Classification, { income: Maybe; expense: Maybe }>();
    const byCat = new Map<string, { direction: Direction; category: string; label: string; amounts: Amounts }>();
    const byPlace = new Map<string, { label: string; income: Maybe; expense: Maybe }>();
    const vat = { output: null as number | null, input: null as number | null, mixed_output: null as number | null, mixed_input: null as number | null };
    for (const g of groups) {
      const dir = g.direction as Direction;
      if (dir === 'income') income = add(income, g.gross, g.vat); else expense = add(expense, g.gross, g.vat);
      const c = byClass.get(g.classification) ?? { income: null, expense: null };
      c[dir] = add(c[dir], g.gross, g.vat);
      byClass.set(g.classification, c);
      const ck = `${dir}:${g.category}`;
      const cat = byCat.get(ck) ?? { direction: dir, category: g.category, label: categoryName(dir, g.category), amounts: { gross: 0, net: 0, vat: 0 } };
      cat.amounts = add(cat.amounts, g.gross, g.vat);
      byCat.set(ck, cat);
      const pk = [g.domain, g.branch ?? '', g.location ?? ''].join('|');
      const pl = byPlace.get(pk) ?? { label: contextLabel(g, null), income: null, expense: null };
      pl[dir] = add(pl[dir], g.gross, g.vat);
      byPlace.set(pk, pl);
      if (g.classification === 'business') {
        if (dir === 'income') vat.output = r2((vat.output ?? 0) + g.vat); else vat.input = r2((vat.input ?? 0) + g.vat);
      } else if (g.classification === 'mixed') {
        if (dir === 'income') vat.mixed_output = r2((vat.mixed_output ?? 0) + g.vat); else vat.mixed_input = r2((vat.mixed_input ?? 0) + g.vat);
      }
    }
    const net = income || expense
      ? { gross: r2((income?.gross ?? 0) - (expense?.gross ?? 0)), net: r2((income?.net ?? 0) - (expense?.net ?? 0)) }
      : null;
    const sortDesc = <T,>(xs: T[], key: (x: T) => number) => xs.sort((a, b) => key(b) - key(a));
    return {
      ready: true as const, from: f.from, to: f.to,
      income, expense, net,
      vat: { ...vat, balance: vat.output !== null || vat.input !== null ? r2((vat.output ?? 0) - (vat.input ?? 0)) : null },
      by_classification: (['business', 'personal', 'mixed'] as Classification[])
        .map(c => ({ classification: c, income: byClass.get(c)?.income ?? null, expense: byClass.get(c)?.expense ?? null })),
      by_category: sortDesc([...byCat.values()], c => c.amounts.gross),
      by_place: sortDesc([...byPlace.entries()].map(([key, v]) => ({ key, ...v })), x => (x.income?.gross ?? 0) + (x.expense?.gross ?? 0)),
      transactions: list.slice(0, LIMIT).map(r => toTx(u, r)),
      truncated: list.length > LIMIT,
    };
  } catch (e) {
    if (!missing(e)) throw e;
    return {
      ready: false as const, from: f.from, to: f.to, income: null, expense: null, net: null,
      vat: { output: null, input: null, mixed_output: null, mixed_input: null, balance: null },
      by_classification: [] as { classification: Classification; income: Maybe; expense: Maybe }[],
      by_category: [] as { direction: Direction; category: string; label: string; amounts: Amounts }[],
      by_place: [] as { key: string; label: string; income: Maybe; expense: Maybe }[],
      transactions: [] as Transaction[], truncated: false,
    };
  }
}
export type FinanceSummary = Awaited<ReturnType<typeof financeSummary>>;

// ── Monthly VAT: output (business income) vs input (business expenses). Mixed shown apart, not counted.
export type VatMonth = {
  month: string; output: number | null; input: number | null; balance: number | null;
  mixed_output: number | null; mixed_input: number | null;
};

export async function vatMonthly(u: SessionUser, months = 6, place?: Partial<Place> | null): Promise<{ ready: boolean; months: VatMonth[] }> {
  const n = Math.min(Math.max(Math.trunc(months) || 6, 1), 24);
  const thisMonth = todayIL().slice(0, 7);
  const start = (() => { const d = new Date(`${thisMonth}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - (n - 1)); return d.toISOString().slice(0, 10); })();
  const q = params([start]);
  try {
    const { rows } = await db().query(
      `SELECT to_char(date_trunc('month', t.occurred_on), 'YYYY-MM') AS month,
              SUM(t.vat_amount) FILTER (WHERE t.classification = 'business' AND t.direction = 'income')::float  AS output,
              SUM(t.vat_amount) FILTER (WHERE t.classification = 'business' AND t.direction = 'expense')::float AS input,
              SUM(t.vat_amount) FILTER (WHERE t.classification = 'mixed' AND t.direction = 'income')::float     AS mixed_output,
              SUM(t.vat_amount) FILTER (WHERE t.classification = 'mixed' AND t.direction = 'expense')::float    AS mixed_input
       FROM transactions t
       WHERE t.deleted_at IS NULL AND t.occurred_on >= $1::date AND t.classification <> 'personal' AND coalesce(t.currency, 'ILS') = 'ILS'
         AND ${visibleSql(u, 'money', 't', q.p)} AND ${placeSql(place, 't', q.p)}
       GROUP BY 1`, q.values);
    const byMonth = new Map(rows.map(r => [r.month as string, r]));
    const out: VatMonth[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(`${thisMonth}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i);
      const m = d.toISOString().slice(0, 7);
      const r = byMonth.get(m);
      const output = r?.output ?? null, input = r?.input ?? null;
      out.push({ month: m, output, input, balance: output !== null || input !== null ? r2((output ?? 0) - (input ?? 0)) : null,
        mixed_output: r?.mixed_output ?? null, mixed_input: r?.mixed_input ?? null });
    }
    return { ready: true, months: out };
  } catch (e) {
    if (!missing(e)) throw e;
    return { ready: false, months: [] };
  }
}

// ── Collections ───────────────────────────────────────────────────────────────
export type ReceivableFilter = 'all' | 'overdue' | 'week' | 'paid' | 'pending';
export const RECEIVABLE_FILTERS: { key: ReceivableFilter; label: string }[] = [
  { key: 'all', label: 'הכל' }, { key: 'overdue', label: 'באיחור' }, { key: 'week', label: 'השבוע' },
  { key: 'paid', label: 'שולם' }, { key: 'pending', label: 'ממתין' },
];
export const parseReceivableFilter = (v: unknown): ReceivableFilter =>
  RECEIVABLE_FILTERS.some(f => f.key === v) ? (v as ReceivableFilter) : 'all';

export type Receivable = {
  id: string; client_name: string; client_tax_id: string | null; amount: number; amount_paid: number; remaining: number;
  issued_on: string | null; due_date: string; stored_status: 'pending' | 'partial' | 'paid';
  status: 'pending' | 'partial' | 'paid' | 'overdue'; days_overdue: number | null;
  invoice_number: string | null; invoice_file_id: string | null; note: string | null; paid_at: string | null;
  domain: string; branch: string | null; location: string | null; context: string; can_edit: boolean; can_delete: boolean;
};

async function receivableRows(u: SessionUser, place?: Partial<Place> | null): Promise<Receivable[]> {
  const today = todayIL();
  const q = params();
  const { rows } = await db().query(
    `SELECT r.id, r.client_name, r.client_tax_id, r.amount::float AS amount, r.amount_paid::float AS amount_paid,
            to_char(r.issued_on, 'YYYY-MM-DD') AS issued_on, to_char(r.due_date, 'YYYY-MM-DD') AS due_date, r.status,
            r.invoice_number, r.invoice_file_id, r.note, r.paid_at, r.domain, r.branch, r.location, r.owner_user_id, r.scope
     FROM receivables r
     WHERE r.deleted_at IS NULL AND ${visibleSql(u, 'money', 'r', q.p)} AND ${placeSql(place, 'r', q.p)}
     ORDER BY r.due_date, r.created_at`, q.values);
  return rows.map(r => {
    const v = money.receivableView(r, today);
    return {
      id: r.id, client_name: r.client_name, client_tax_id: r.client_tax_id, amount: r.amount, amount_paid: r.amount_paid,
      remaining: v.remaining, issued_on: r.issued_on, due_date: r.due_date, stored_status: r.status, status: v.status,
      days_overdue: v.days_overdue, invoice_number: r.invoice_number, invoice_file_id: r.invoice_file_id, note: r.note,
      paid_at: r.paid_at ? new Date(r.paid_at).toISOString() : null, domain: r.domain, branch: r.branch, location: r.location,
      context: contextLabel(r, null), can_edit: canEditRow(u, 'money', r), can_delete: canDeleteRow(u, 'money', r),
    };
  });
}

export async function receivables(u: SessionUser, filter: ReceivableFilter = 'all', place?: Partial<Place> | null) {
  const today = todayIL();
  const week = periodBounds('week', today);
  try {
    const all = await receivableRows(u, place);
    const match: Record<ReceivableFilter, (r: Receivable) => boolean> = {
      all: () => true,
      overdue: r => r.status === 'overdue',
      week: r => r.status !== 'paid' && r.due_date >= week.start && r.due_date <= week.end,
      paid: r => r.status === 'paid',
      pending: r => r.status === 'pending' || r.status === 'partial',
    };
    const open = all.filter(r => r.status !== 'paid');
    return {
      ready: true as const, today, filter, week,
      items: all.filter(match[filter]),
      counts: Object.fromEntries(RECEIVABLE_FILTERS.map(f => [f.key, all.filter(match[f.key]).length])) as Record<ReceivableFilter, number>,
      open_total: open.length ? r2(open.reduce((a, r) => a + r.remaining, 0)) : null,
      overdue_total: open.some(r => r.status === 'overdue') ? r2(open.filter(r => r.status === 'overdue').reduce((a, r) => a + r.remaining, 0)) : null,
      may_add: true,
    };
  } catch (e) {
    if (!missing(e)) throw e;
    return {
      ready: false as const, today, filter, week, items: [] as Receivable[],
      counts: { all: 0, overdue: 0, week: 0, paid: 0, pending: 0 } as Record<ReceivableFilter, number>,
      open_total: null, overdue_total: null, may_add: false,
    };
  }
}

// ── Home KPIs ─────────────────────────────────────────────────────────────────
// Business income this month (Israel time), ex-VAT. net/gross null when there are no rows.
export async function monthRevenue(u: SessionUser): Promise<{ ready: boolean; month: string; net: number | null; gross: number | null; count: number }> {
  const today = todayIL();
  const { start, end } = periodBounds('month', today);
  const q = params([start, end]);
  try {
    const { rows: [r] } = await db().query(
      `SELECT COUNT(*)::int AS n, SUM(t.amount_gross)::float AS gross, SUM(t.amount_gross - t.vat_amount)::float AS net
       FROM transactions t
       WHERE t.deleted_at IS NULL AND t.direction = 'income' AND t.classification = 'business'
         AND t.occurred_on BETWEEN $1::date AND $2::date AND ${visibleSql(u, 'money', 't', q.p)}`, q.values);
    return { ready: true, month: today.slice(0, 7), count: r.n, net: r.n ? r2(r.net) : null, gross: r.n ? r2(r.gross) : null };
  } catch (e) {
    if (!missing(e)) throw e;
    return { ready: false, month: today.slice(0, 7), count: 0, net: null, gross: null };
  }
}

// Money still owed to us, incl. VAT: open dashboard receivables + open vault debts (vault part only
// for users who may see a-digital money). total null when neither has anything open.
export async function openReceivablesTotal(u: SessionUser): Promise<{
  total: number | null; dashboard: number | null; vault: number | null; dashboard_count: number; vault_count: number; overdue_count: number;
}> {
  let dashboard: number | null = null, dashboardCount = 0, overdueCount = 0;
  try {
    const open = (await receivableRows(u)).filter(r => r.status !== 'paid');
    dashboardCount = open.length;
    overdueCount = open.filter(r => r.status === 'overdue').length;
    dashboard = open.length ? r2(open.reduce((a, r) => a + r.remaining, 0)) : null;
  } catch (e) {
    if (!missing(e)) throw e;
  }
  let vault: number | null = null, vaultCount = 0;
  const adigital = { domain: 'business', branch: 'adigital', location: null };
  if (u.isAdmin || canSeePlace(u, adigital, 'money')) {
    try {
      const v = await vaultFinance(u.isAdmin ? null : 'adigital');
      vault = v.debt_total;
      vaultCount = v.debts.length;
    } catch (e) {
      if (!missing(e)) throw e;
    }
  }
  const total = dashboard === null && vault === null ? null : r2((dashboard ?? 0) + (vault ?? 0));
  return { total, dashboard, vault, dashboard_count: dashboardCount, vault_count: vaultCount, overdue_count: overdueCount };
}

// ── Household book (personal, shared) on transactions ─────────────────────────
export async function householdTransactions(u: SessionUser, month: string /* YYYY-MM */) {
  const start = `${month}-01`;
  const end = addDays((() => { const d = new Date(`${start}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })(), -1);
  const q = params([start, end]);
  const vis = visibleSql(u, 'money', 't', q.p);
  const scope = `t.deleted_at IS NULL AND t.domain = 'personal' AND t.classification = 'personal' AND t.scope = 'shared' AND ${vis}`;
  try {
    const [{ rows }, { rows: months }] = await Promise.all([
      db().query(
        `SELECT ${TX_SELECT} FROM transactions t LEFT JOIN files f ON f.id = t.file_id
         WHERE ${scope} AND t.occurred_on BETWEEN $1::date AND $2::date
         ORDER BY t.occurred_on DESC, t.created_at DESC LIMIT 1000`, q.values),
      db().query(
        `SELECT to_char(date_trunc('month', t.occurred_on), 'YYYY-MM') AS month,
                SUM(t.amount_gross) FILTER (WHERE t.direction = 'income')::float AS income,
                SUM(t.amount_gross) FILTER (WHERE t.direction = 'expense')::float AS expense
         FROM transactions t
         WHERE ${scope} AND t.occurred_on >= ($1::date - interval '5 months') AND t.occurred_on <= $2::date
         GROUP BY 1 ORDER BY 1`, q.values),
    ]);
    const entries = rows.map(r => toTx(u, r));
    const sum = (k: Direction) => r2(entries.filter(e => e.direction === k).reduce((a, e) => a + e.amount_gross, 0));
    const byCat = new Map<string, { category: string; label: string; total: number }>();
    for (const e of entries.filter(x => x.direction === 'expense')) {
      const c = byCat.get(e.category) ?? { category: e.category, label: e.category_label, total: 0 };
      c.total = r2(c.total + e.amount_gross);
      byCat.set(e.category, c);
    }
    return {
      ready: true, month, entries,
      income: entries.some(e => e.direction === 'income') ? sum('income') : null,
      expense: entries.some(e => e.direction === 'expense') ? sum('expense') : null,
      by_category: [...byCat.values()].sort((a, b) => b.total - a.total),
      months: months as { month: string; income: number | null; expense: number | null }[],
    };
  } catch (e) {
    if (!missing(e)) throw e;
    return { ready: false, month, entries: [] as Transaction[], income: null, expense: null,
      by_category: [] as { category: string; label: string; total: number }[], months: [] as { month: string; income: number | null; expense: number | null }[] };
  }
}
