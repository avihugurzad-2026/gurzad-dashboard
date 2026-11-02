import 'server-only';
import { db } from './db';
import type { SessionUser } from './auth';
import { loadWorkspaces, roleIn, type WorkspaceRow } from './workspaces';
import L from '@domain/ledger';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Reads of the personal / household finance engine. Every function takes a workspace the caller
// has already opened with `ledgerAccess` (personal: its owner only; household: its members).
// The household side never selects a member's personal rows, income or the private fields of a
// contribution plan (percentage, source account). No rows → null ("אין נתונים עדיין"), never 0.

const missing = (e: any) => e?.code === '42P01' || e?.code === '42703';
const r2 = L.round2;

export type Access = { w: WorkspaceRow; role: string; canWrite: boolean };

// May `u` read (and write) this personal or household workspace's money?
export async function ledgerAccess(u: SessionUser, wsId: string | null | undefined): Promise<Access | null> {
  if (!wsId) return null;
  const w = (await loadWorkspaces()).find(x => x.id === wsId);
  if (!w || (w.kind !== 'personal' && w.kind !== 'household')) return null;
  const role = roleIn(u, w);
  if (!role) return null;
  return { w, role, canWrite: ['owner', 'admin', 'manager', 'member'].includes(role) };
}

// Who sees a ledger row: shared rows, and "only me" rows of their owner. (A household book can hold an
// "only me" row someone filed there before; it stays private to them.)
const seenBy = (alias: string, param: string) => `(${alias}scope = 'shared' OR ${alias}owner_user_id = ${param})`;
// Totals add up shekels only: a row in another currency is listed with its currency and counted apart
const ILS = (alias = '') => `coalesce(${alias}currency, 'ILS') = 'ILS'`;

// ── Lookups ───────────────────────────────────────────────────────────────────
export type Account = {
  id: string; kind: string; name: string; institution: string | null; last4: string | null; currency: string;
  opening_balance: number | null; balance: number | null; balance_as_of: string | null; credit_limit: number | null;
  billing_day: number | null; notes: string | null; owner_user_id: string; month_out: number | null; month_in: number | null;
};
export async function listAccounts(wsId: string, month?: string): Promise<{ ready: boolean; items: Account[] }> {
  const m = month ?? new Date().toISOString().slice(0, 7);
  try {
    const { rows } = await db().query(
      `SELECT a.id, a.kind, a.name, a.institution, a.last4, a.currency, a.opening_balance::float, a.balance::float,
              to_char(a.balance_as_of, 'YYYY-MM-DD') AS balance_as_of, a.credit_limit::float, a.billing_day, a.notes, a.owner_user_id,
              (SELECT SUM(t.amount_gross) FROM transactions t WHERE t.account_id = a.id AND t.deleted_at IS NULL
                 AND to_char(t.occurred_on, 'YYYY-MM') = $2 AND (t.direction = 'expense' OR t.flow = 'out'))::float AS month_out,
              (SELECT SUM(t.amount_gross) FROM transactions t WHERE t.account_id = a.id AND t.deleted_at IS NULL
                 AND to_char(t.occurred_on, 'YYYY-MM') = $2 AND (t.direction = 'income' OR t.flow = 'in'))::float AS month_in
       FROM financial_accounts a WHERE a.workspace_id = $1 AND a.deleted_at IS NULL
       ORDER BY CASE a.kind WHEN 'bank' THEN 1 WHEN 'credit_card' THEN 2 WHEN 'savings' THEN 3 ELSE 4 END, a.name`, [wsId, m]);
    return { ready: true, items: rows };
  } catch (e) {
    if (missing(e)) return { ready: false, items: [] };
    throw e;
  }
}

export type Category = { id: string; kind: 'income' | 'expense'; name: string; parent_id: string | null; key: string | null; sort: number | null };
export async function listCategories(wsId: string): Promise<Category[]> {
  try {
    const { rows } = await db().query(
      `SELECT id, kind, name, parent_id, key, sort FROM transaction_categories
       WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY kind DESC, sort NULLS LAST, name`, [wsId]);
    return rows;
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

// ── Transactions ──────────────────────────────────────────────────────────────
export type LedgerTx = {
  id: string; direction: 'income' | 'expense' | 'transfer'; flow: 'in' | 'out' | null; occurred_on: string; amount: number; currency: string;
  merchant: string | null; description: string | null; notes: string | null;
  category_id: string | null; category: string | null; subcategory_id: string | null; subcategory: string | null;
  account_id: string | null; account: string | null; fixed_or_variable: 'fixed' | 'variable' | null; frequency: string | null;
  source: string; document_id: string | null; owner_user_id: string; owner_name: string | null; linked: boolean; locked: boolean;
};

export type TxFilter = { from: string; to: string; direction?: string | null; account?: string | null; category?: string | null; q?: string | null; limit?: number };

export async function listTransactions(wsId: string, f: TxFilter, viewer: string): Promise<{ ready: boolean; items: LedgerTx[]; more: boolean }> {
  const vals: unknown[] = [wsId, f.from, f.to, viewer];
  const p = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  const where = ['t.workspace_id = $1', 't.deleted_at IS NULL', 't.occurred_on BETWEEN $2::date AND $3::date', seenBy('t.', '$4')];
  if (f.direction === 'income' || f.direction === 'expense' || f.direction === 'transfer') where.push(`t.direction = ${p(f.direction)}`);
  if (f.account) where.push(`t.account_id = ${p(f.account)}::uuid`);
  if (f.category) where.push(`(t.category_id = ${p(f.category)}::uuid OR t.subcategory_id = $${vals.length}::uuid)`);
  if (f.q) where.push(`(t.merchant ILIKE ${p(`%${f.q.replace(/[\\%_]/g, m => `\\${m}`)}%`)} OR t.description ILIKE $${vals.length} OR t.notes ILIKE $${vals.length})`);
  const limit = Math.min(Math.max(f.limit ?? 300, 1), 1000);
  try {
    const { rows } = await db().query(
      `SELECT t.id, t.direction, t.flow, to_char(t.occurred_on, 'YYYY-MM-DD') AS occurred_on, t.amount_gross::float AS amount, t.currency,
              t.merchant, t.description, t.notes, t.category_id, c.name AS category, t.subcategory_id, sc.name AS subcategory,
              t.account_id, a.name AS account, t.fixed_or_variable, t.frequency, t.source, t.document_id, t.owner_user_id, us.name AS owner_name,
              t.linked_transaction_id IS NOT NULL AS linked
       FROM transactions t
       LEFT JOIN transaction_categories c ON c.id = t.category_id
       LEFT JOIN transaction_categories sc ON sc.id = t.subcategory_id
       LEFT JOIN financial_accounts a ON a.id = t.account_id
       LEFT JOIN users us ON us.id = t.owner_user_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.occurred_on DESC, t.created_at DESC LIMIT ${limit + 1}`, vals);
    return {
      ready: true, more: rows.length > limit,
      items: rows.slice(0, limit).map(r => ({ ...r, locked: r.source === 'contribution' })),
    };
  } catch (e) {
    if (missing(e)) return { ready: false, items: [], more: false };
    throw e;
  }
}

// Month totals. Transfers are their own line: a contribution out of the personal side is not
// "spending", and inside the household it is income from a member.
export type MonthSummary = {
  income: number | null; expense: number | null; transfersOut: number | null; transfersIn: number | null; net: number | null;
  fixed: number | null; variable: number | null;
  byCategory: { category_id: string | null; name: string; total: number }[];
  months: { month: string; income: number | null; expense: number | null }[];
  foreign: { currency: string; n: number; total: number }[];   // rows in other currencies, not in the totals above
};
export async function monthSummary(wsId: string, month: string, viewer: string): Promise<MonthSummary | null> {
  const start = `${month}-01`;
  const end = L.addMonths(start, 1);
  try {
    const [{ rows: [t] }, { rows: cats }, { rows: months }, { rows: foreign }] = await Promise.all([
      db().query(
        `SELECT SUM(amount_gross) FILTER (WHERE direction = 'income')::float AS income,
                SUM(amount_gross) FILTER (WHERE direction = 'expense')::float AS expense,
                SUM(amount_gross) FILTER (WHERE direction = 'transfer' AND flow = 'out')::float AS tout,
                SUM(amount_gross) FILTER (WHERE direction = 'transfer' AND flow = 'in')::float AS tin,
                SUM(amount_gross) FILTER (WHERE direction = 'expense' AND fixed_or_variable = 'fixed')::float AS fixed,
                SUM(amount_gross) FILTER (WHERE direction = 'expense' AND coalesce(fixed_or_variable, 'variable') = 'variable')::float AS variable,
                COUNT(*)::int AS n
         FROM transactions WHERE workspace_id = $1 AND deleted_at IS NULL AND occurred_on >= $2::date AND occurred_on < $3::date
           AND ${seenBy('', '$4')} AND ${ILS()}`, [wsId, start, end, viewer]),
      db().query(
        `SELECT t.category_id, coalesce(c.name, 'ללא קטגוריה') AS name, SUM(t.amount_gross)::float AS total
         FROM transactions t LEFT JOIN transaction_categories c ON c.id = t.category_id
         WHERE t.workspace_id = $1 AND t.deleted_at IS NULL AND t.direction = 'expense' AND t.occurred_on >= $2::date AND t.occurred_on < $3::date
           AND ${seenBy('t.', '$4')} AND ${ILS('t.')}
         GROUP BY 1, 2 ORDER BY 3 DESC`, [wsId, start, end, viewer]),
      db().query(
        `SELECT to_char(date_trunc('month', occurred_on), 'YYYY-MM') AS month,
                SUM(amount_gross) FILTER (WHERE direction = 'income')::float AS income,
                SUM(amount_gross) FILTER (WHERE direction = 'expense')::float AS expense
         FROM transactions WHERE workspace_id = $1 AND deleted_at IS NULL
           AND occurred_on >= ($2::date - interval '5 months') AND occurred_on < $3::date AND ${seenBy('', '$4')} AND ${ILS()}
         GROUP BY 1 ORDER BY 1`, [wsId, start, end, viewer]),
      db().query(
        `SELECT currency, COUNT(*)::int AS n, SUM(amount_gross)::float AS total FROM transactions
         WHERE workspace_id = $1 AND deleted_at IS NULL AND occurred_on >= $2::date AND occurred_on < $3::date
           AND ${seenBy('', '$4')} AND NOT ${ILS()} GROUP BY 1 ORDER BY 1`, [wsId, start, end, viewer]),
    ]);
    if (!t.n && !months.length && !foreign.length) return emptySummary();
    const net = t.income !== null || t.expense !== null || t.tout !== null || t.tin !== null
      ? r2((t.income ?? 0) + (t.tin ?? 0) - (t.expense ?? 0) - (t.tout ?? 0)) : null;
    return {
      income: t.income, expense: t.expense, transfersOut: t.tout, transfersIn: t.tin, net,
      fixed: t.fixed, variable: t.variable, byCategory: cats, months, foreign,
    };
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}
const emptySummary = (): MonthSummary => ({ income: null, expense: null, transfersOut: null, transfersIn: null, net: null, fixed: null, variable: null, byCategory: [], months: [], foreign: [] });

// ── Budget ────────────────────────────────────────────────────────────────────
export async function budgetFor(wsId: string, month: string, viewer: string) {
  const start = `${month}-01`;
  try {
    const { rows: [b] } = await db().query(`SELECT id, notes FROM budgets WHERE workspace_id = $1 AND month = $2::date AND deleted_at IS NULL`, [wsId, start]);
    const { rows: actualRows } = await db().query(
      `SELECT coalesce(c.parent_id, t.category_id)::text AS category_id, SUM(t.amount_gross)::float AS total
       FROM transactions t LEFT JOIN transaction_categories c ON c.id = t.category_id
       WHERE t.workspace_id = $1 AND t.deleted_at IS NULL AND t.direction = 'expense' AND t.category_id IS NOT NULL
         AND t.occurred_on >= $2::date AND t.occurred_on < ($2::date + interval '1 month') AND ${seenBy('t.', '$3')} AND ${ILS('t.')} GROUP BY 1`, [wsId, start, viewer]);
    const actuals = Object.fromEntries(actualRows.map(r => [r.category_id, r.total]));
    const { rows: [unc] } = await db().query(
      `SELECT SUM(amount_gross)::float AS total FROM transactions WHERE workspace_id = $1 AND deleted_at IS NULL AND direction = 'expense'
         AND category_id IS NULL AND occurred_on >= $2::date AND occurred_on < ($2::date + interval '1 month') AND ${seenBy('', '$3')} AND ${ILS()}`, [wsId, start, viewer]);
    if (!b) return { ready: true, budget: null, view: null, actuals, uncategorized: unc.total as number | null };
    const { rows: lines } = await db().query(
      `SELECT bc.category_id::text, c.name, bc.amount::float AS budget FROM budget_categories bc
       JOIN transaction_categories c ON c.id = bc.category_id WHERE bc.budget_id = $1 ORDER BY c.sort NULLS LAST, c.name`, [b.id]);
    return { ready: true, budget: { id: b.id as string, notes: b.notes as string | null }, view: L.budgetView(lines, actuals), actuals, uncategorized: unc.total as number | null };
  } catch (e) {
    if (missing(e)) return { ready: false, budget: null, view: null, actuals: {}, uncategorized: null };
    throw e;
  }
}

export async function latestBudgetBefore(wsId: string, month: string): Promise<string | null> {
  try {
    const { rows } = await db().query(
      `SELECT to_char(month, 'YYYY-MM') AS m FROM budgets WHERE workspace_id = $1 AND month < $2::date AND deleted_at IS NULL ORDER BY month DESC LIMIT 1`,
      [wsId, `${month}-01`]);
    return rows[0]?.m ?? null;
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

// ── Recurring expenses ────────────────────────────────────────────────────────
export type Recurring = {
  id: string; name: string; merchant: string | null; amount: number; currency: string; category_id: string | null; category: string | null;
  account_id: string | null; account: string | null; frequency: 'monthly' | 'yearly' | 'custom' | 'one_time'; interval_months: number | null;
  day_of_month: number | null; next_due: string | null; start_date: string | null; end_date: string | null; status: string; notes: string | null;
  monthly: number;
};
export async function listRecurring(wsId: string): Promise<{ ready: boolean; items: Recurring[]; monthlyTotal: number | null }> {
  try {
    const { rows } = await db().query(
      `SELECT r.id, r.name, r.merchant, r.amount::float, r.currency, r.category_id, c.name AS category, r.account_id, a.name AS account,
              r.frequency, r.interval_months, r.day_of_month, to_char(r.next_due, 'YYYY-MM-DD') AS next_due,
              to_char(r.start_date, 'YYYY-MM-DD') AS start_date, to_char(r.end_date, 'YYYY-MM-DD') AS end_date, r.status, r.notes
       FROM recurring_expenses r LEFT JOIN transaction_categories c ON c.id = r.category_id LEFT JOIN financial_accounts a ON a.id = r.account_id
       WHERE r.workspace_id = $1 AND r.deleted_at IS NULL ORDER BY r.status, r.next_due NULLS LAST, r.name`, [wsId]);
    const items = rows.map(r => ({ ...r, monthly: L.monthlyEquivalent(r) }));
    const active = items.filter(r => r.status === 'active');
    return { ready: true, items, monthlyTotal: active.length ? r2(active.reduce((a, r) => a + r.monthly, 0)) : null };
  } catch (e) {
    if (missing(e)) return { ready: false, items: [], monthlyTotal: null };
    throw e;
  }
}

// ── Savings goals ─────────────────────────────────────────────────────────────
export type SavingsGoal = {
  id: string; name: string; target_amount: number; current_amount: number; deadline: string | null; monthly_contribution: number | null;
  account_id: string | null; status: string; notes: string | null; view: ReturnType<typeof L.savingsView>;
};
export async function listSavings(wsId: string, today: string): Promise<{ ready: boolean; items: SavingsGoal[] }> {
  try {
    const { rows } = await db().query(
      `SELECT id, name, target_amount::float, current_amount::float, to_char(deadline, 'YYYY-MM-DD') AS deadline,
              monthly_contribution::float, account_id, status, notes
       FROM savings_goals WHERE workspace_id = $1 AND deleted_at IS NULL
       ORDER BY CASE status WHEN 'active' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END, deadline NULLS LAST, name`, [wsId]);
    return { ready: true, items: rows.map(g => ({ ...g, view: L.savingsView(g, today) })) };
  } catch (e) {
    if (missing(e)) return { ready: false, items: [] };
    throw e;
  }
}

// ── Contributions ─────────────────────────────────────────────────────────────
// Household side: who contributes, the amount and the payments. Never the percentage or source account.
export type HouseholdContribution = {
  id: string; user_id: string; name: string; rule: 'fixed' | 'percentage' | 'manual'; amount: number | null;
  frequency: string; day_of_month: number; start_date: string; end_date: string | null; status: string; auto_or_manual: string; next: string | null;
};
export type ContributionPayment = { id: string; contribution_id: string; user_id: string; name: string; period: string; amount: number; status: string; paid_on: string | null };

export async function householdContributions(wsId: string, period: string, today: string) {
  try {
    const { rows: plans } = await db().query(
      `SELECT c.id, c.user_id, us.name, c.rule, CASE WHEN c.rule = 'fixed' THEN c.amount::float END AS amount,
              c.frequency, c.day_of_month, to_char(c.start_date, 'YYYY-MM-DD') AS start_date, to_char(c.end_date, 'YYYY-MM-DD') AS end_date,
              c.status, c.auto_or_manual
       FROM household_contributions c JOIN users us ON us.id = c.user_id
       WHERE c.workspace_id = $1 AND c.deleted_at IS NULL ORDER BY c.status, us.name`, [wsId]);
    const { rows: payments } = await db().query(
      `SELECT p.id, p.contribution_id, p.user_id, us.name, to_char(p.period, 'YYYY-MM') AS period, p.amount::float, p.status,
              to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on
       FROM household_contribution_payments p JOIN users us ON us.id = p.user_id
       WHERE p.workspace_id = $1 AND p.status <> 'cancelled' ORDER BY p.period DESC, p.paid_on DESC NULLS LAST LIMIT 200`, [wsId]);
    const items: HouseholdContribution[] = plans.map(c => ({ ...c, next: L.nextContribution(c, today) }));
    const month = L.contributionMonth(plans, payments.filter(p => `${p.period}-01` === period), period);
    return { ready: true, plans: items, payments: payments as ContributionPayment[], month };
  } catch (e) {
    if (missing(e)) return { ready: false, plans: [] as HouseholdContribution[], payments: [] as ContributionPayment[], month: null };
    throw e;
  }
}

// Personal side: my plans to every household I belong to, with the private fields
export type MyContribution = HouseholdContribution & {
  workspace_id: string; household: string; percentage: number | null; source_account_id: string | null;
  fixed_amount: number | null; this_month_paid: number | null;
};
export async function myContributions(u: SessionUser, today: string): Promise<MyContribution[]> {
  try {
    const { rows } = await db().query(
      `SELECT c.id, c.workspace_id, w.name AS household, c.user_id, us.name, c.rule, c.amount::float AS fixed_amount, c.percentage::float,
              c.frequency, c.day_of_month, to_char(c.start_date, 'YYYY-MM-DD') AS start_date, to_char(c.end_date, 'YYYY-MM-DD') AS end_date,
              c.status, c.auto_or_manual, c.source_account_id,
              (SELECT SUM(p.amount) FROM household_contribution_payments p WHERE p.contribution_id = c.id AND p.status = 'received'
                 AND p.period = date_trunc('month', $2::date))::float AS this_month_paid
       FROM household_contributions c JOIN workspaces w ON w.id = c.workspace_id AND w.deleted_at IS NULL JOIN users us ON us.id = c.user_id
       WHERE c.user_id = $1 AND c.deleted_at IS NULL ORDER BY c.status, w.name`, [u.id, today]);
    return rows.map(c => ({ ...c, amount: c.fixed_amount, next: L.nextContribution(c, today) }));
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

// ── Rules ─────────────────────────────────────────────────────────────────────
export type Rule = {
  id: string; match_field: string; match_type: string; pattern: string; target_workspace_id: string; workspace: string;
  category_id: string | null; category: string | null; subcategory_id: string | null; fixed_or_variable: string | null; frequency: string | null;
  priority: number; hits: number; active: boolean;
};
export async function listRules(u: SessionUser): Promise<Rule[]> {
  try {
    const { rows } = await db().query(
      `SELECT r.id, r.match_field, r.match_type, r.pattern, r.target_workspace_id, w.name AS workspace, r.category_id, c.name AS category,
              r.subcategory_id, r.fixed_or_variable, r.frequency, r.priority, r.hits, r.active
       FROM categorization_rules r JOIN workspaces w ON w.id = r.target_workspace_id LEFT JOIN transaction_categories c ON c.id = r.category_id
       WHERE r.owner_user_id = $1 AND r.deleted_at IS NULL ORDER BY r.priority, r.pattern`, [u.id]);
    return rows;
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}
