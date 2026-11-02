import 'server-only';
import { db } from './db';
import { canSeePlace, params, visibleSql, type SessionUser } from './auth';
import { workItems, goalsFor, type Goal } from './entries';
import { addDays, periodBounds, todayIL, type RangeKey } from '@/lib/period';
import { ENTITIES } from '@/lib/places';
import money from '@domain/money';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Stage 3.7 Home snapshots: one card per business (revenue in the period and today, urgent and
// overdue tasks) and one personal card (expenses, this week's tasks, the financial goal).
// Everything is read through visibleSql, so a user only gets the places they may see.
// No rows → null ("אין נתונים עדיין"), never 0.

const missing = (e: any) => e?.code === '42P01' || e?.code === '42703';
const r2 = money.round2;

export type BusinessCard = {
  branch: string; label: string; href: string;
  revenue: { net: number | null; count: number; today: number | null } | null; // null = no money access
  revenueSource: 'dashboard' | 'buyz';
  urgent: number; overdue: number; open: number;
};

export type PersonalCard = {
  expenses: number | null; expenseCount: number; // null = no money access or no rows
  moneyAccess: boolean;
  weekTasks: number; weekOverdue: number;
  goal: (Goal & { pct: number | null }) | null;
};

const money_ = (u: SessionUser, p: { domain: string; branch?: string | null }) => canSeePlace(u, p, 'money');

// Income per business branch for the period and for today (net = without VAT).
async function revenueByBranch(u: SessionUser, start: string, end: string, today: string) {
  const q = params([start, end, today]);
  try {
    const { rows } = await db().query(
      `SELECT t.branch, COUNT(*)::int AS n, SUM(t.amount_gross - t.vat_amount)::float AS net,
              SUM(t.amount_gross - t.vat_amount) FILTER (WHERE t.occurred_on = $3::date)::float AS today
       FROM transactions t
       WHERE t.deleted_at IS NULL AND t.direction = 'income' AND t.domain = 'business'
         AND t.occurred_on BETWEEN $1::date AND $2::date AND ${visibleSql(u, 'money', 't', q.p)}
       GROUP BY t.branch`, q.values);
    return new Map(rows.map((r: any) => [r.branch as string, { n: r.n as number, net: r.net as number | null, today: r.today as number | null }]));
  } catch (e) {
    if (!missing(e)) throw e;
    return new Map<string, { n: number; net: number | null; today: number | null }>();
  }
}

// `external` lets a branch whose sales come from an integration (Head Spa ← Buyz) supply its own numbers.
export async function businessSnapshot(u: SessionUser, range: RangeKey,
  external: Record<string, { net: number | null; count: number; today: number | null } | null> = {}): Promise<BusinessCard[]> {
  const today = todayIL();
  const { start, end } = periodBounds(range, today);
  const branches = ENTITIES.filter(e => e.domain === 'business' && canSeePlace(u, { domain: 'business', branch: e.id }, 'task'));
  if (!branches.length) return [];
  const [rev, tasks] = await Promise.all([revenueByBranch(u, start, end, today), workItems({ domain: 'business' })]);
  const open = tasks.items.filter(i => i.status !== 'done' && i.status !== 'cancelled');
  return branches.map(b => {
    const mine = open.filter(i => i.branch === b.id);
    const ext = external[b.id];
    const r = rev.get(b.id);
    const revenue = !money_(u, { domain: 'business', branch: b.id }) ? null
      : ext ? ext
      : { net: r?.n ? r2(r.net ?? 0) : null, count: r?.n ?? 0, today: r?.today != null ? r2(r.today) : null };
    return {
      branch: b.id, label: b.label, href: b.href, revenue, revenueSource: ext ? 'buyz' : 'dashboard',
      urgent: mine.filter(i => i.priority <= 2).length, overdue: mine.filter(i => i.days_past).length, open: mine.length,
    };
  });
}

export async function personalSnapshot(u: SessionUser, range: RangeKey): Promise<PersonalCard | null> {
  if (!canSeePlace(u, { domain: 'personal' }, 'task')) return null;
  const today = todayIL();
  const { start, end } = periodBounds(range, today);
  const weekStart = addDays(today, -new Date(`${today}T00:00:00Z`).getUTCDay());
  const weekEnd = addDays(weekStart, 6);
  const moneyAccess = money_(u, { domain: 'personal' });

  const expensesP = (async () => {
    if (!moneyAccess) return { total: null as number | null, n: 0 };
    const q = params([start, end]);
    try {
      const { rows: [r] } = await db().query(
        `SELECT COUNT(*)::int AS n, SUM(t.amount_gross)::float AS total FROM transactions t
         WHERE t.deleted_at IS NULL AND t.direction = 'expense' AND t.domain = 'personal'
           AND t.occurred_on BETWEEN $1::date AND $2::date AND ${visibleSql(u, 'money', 't', q.p)}`, q.values);
      return { total: r.n ? r2(r.total) : null, n: r.n as number };
    } catch (e) {
      if (!missing(e)) throw e;
      return { total: null, n: 0 };
    }
  })();

  const [exp, tasks, goals] = await Promise.all([expensesP, workItems({ domain: 'personal' }), goalsFor({ domain: 'personal' })]);
  const open = tasks.items.filter(i => i.status !== 'done' && i.status !== 'cancelled');
  const goal = goals.goals.find(g => g.status === 'active' && (g.goal_type === 'financial' || g.unit === 'ils')) ?? null;
  return {
    expenses: exp.total, expenseCount: exp.n, moneyAccess,
    weekTasks: open.filter(i => i.due_date && i.due_date >= weekStart && i.due_date <= weekEnd).length,
    weekOverdue: open.filter(i => i.days_past).length,
    goal: goal && { ...goal, pct: goal.target && goal.current !== null ? Math.max(0, Math.min(100, Math.round((goal.current / goal.target) * 100))) : null },
  };
}
