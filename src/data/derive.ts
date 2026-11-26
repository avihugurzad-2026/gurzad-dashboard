import type { Area, Collection, Rec } from './types';
import { computeAlerts, type Alert } from '../../shared/alerts';
import { store } from './store';
import { daysUntil, monthsBack, thisMonth, today, money } from '../lib/format';

/* ---------- parameters (dated, never hard-coded) ---------- */
export function param(key: string, date = today()): number | undefined {
  const rows = store.all('parameters').filter((p) => p.key === key && p.effective_from <= date)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  return rows[0]?.value;
}
export const vatRate = (date?: string) => param('vat_rate', date) ?? 0;
export const gross = (inv: Rec) => Math.round((inv.amount_net || 0) * (1 + vatRate(inv.issue_date)));
export const needsAllocation = (inv: Rec) => {
  const t = param('allocation_threshold', inv.issue_date);
  return t != null && (inv.amount_net || 0) > t && !inv.allocation_number && inv.status !== 'בוטלה' && inv.status !== 'טיוטה';
};
export const invoiceState = (inv: Rec): 'paid' | 'overdue' | 'open' | 'draft' | 'void' => {
  if (inv.status === 'שולמה') return 'paid';
  if (inv.status === 'בוטלה') return 'void';
  if (inv.status === 'טיוטה') return 'draft';
  return inv.due_date && daysUntil(inv.due_date) < 0 ? 'overdue' : 'open';
};

/* ---------- home ---------- */
export function homeMonth(ym = thisMonth()) {
  const tx = store.all('transactions').filter((t) => (t.date || '').startsWith(ym));
  const spent = sum(tx.filter((t) => t.kind === 'הוצאה'), 'amount');
  const income = sum(tx.filter((t) => t.kind === 'הכנסה'), 'amount');
  const budgets = store.all('budgets');
  const budget = sum(budgets, 'monthly');
  const byCat = budgets.map((b) => ({
    category: b.category as string,
    budget: b.monthly as number,
    spent: sum(tx.filter((t) => t.kind === 'הוצאה' && t.category === b.category), 'amount'),
  })).sort((a, b) => b.spent / (b.budget || 1) - a.spent / (a.budget || 1));
  return { spent, income, budget, byCat, tx };
}
export function homeTrend(n = 6) {
  return monthsBack(n).map((m) => {
    const x = homeMonth(m);
    return { month: m, spent: x.spent, income: x.income };
  });
}

/* ---------- business ---------- */
/** ext: monthly income before VAT pulled from connected systems (Buyz…), added to invoice income. */
export function bizSeries(bizId: string, n = 6, ext: Record<string, number> = {}, extExp: Record<string, number> = {}) {
  const inv = store.all('invoices').filter((i) => i.business_id === bizId && i.status !== 'בוטלה' && i.status !== 'טיוטה');
  const exp = store.all('biz_expenses').filter((e) => e.business_id === bizId);
  return monthsBack(n).map((m) => {
    const income = sum(inv.filter((i) => (i.issue_date || '').startsWith(m)), 'amount_net') + (ext[m] ?? 0);
    const expense = sum(exp.filter((e) => (e.date || '').startsWith(m)), 'amount_net') + (extExp[m] ?? 0);
    return { month: m, income, expense, profit: income - expense };
  });
}
export function bizSummary(bizId: string, ext: Record<string, number> = {}, extExp: Record<string, number> = {}) {
  const inv = store.all('invoices').filter((i) => i.business_id === bizId);
  const open = inv.filter((i) => ['open', 'overdue'].includes(invoiceState(i)));
  const overdue = inv.filter((i) => invoiceState(i) === 'overdue');
  const series = bizSeries(bizId, 6, ext, extExp);
  const cur = series[series.length - 1];
  const prev = series[series.length - 2];
  const mrr = sum(store.all('clients').filter((c) => c.business_id === bizId && c.status === 'פעיל'), 'monthly_fee');
  return {
    series, cur, prev, mrr,
    receivable: open.reduce((a, i) => a + gross(i), 0),
    overdue, overdueTotal: overdue.reduce((a, i) => a + gross(i), 0),
    missingAlloc: inv.filter(needsAllocation),
  };
}

/* ---------- investments ---------- */
export function propMetrics(p: Rec) {
  const pays = store.all('rent_payments').filter((x) => x.property_id === p.id);
  const lease = store.all('leases').filter((l) => l.property_id === p.id).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
  const tenant = store.all('tenants').find((t) => t.property_id === p.id);
  const late = pays.filter((x) => (x.paid_amount || 0) < (x.amount || 0) && daysUntil(x.due_date) < 0);
  const lateTotal = late.reduce((a, x) => a + (x.amount - (x.paid_amount || 0)), 0);
  const annualRent = (p.monthly_rent || 0) * 12;
  const yieldGross = p.purchase_price ? annualRent / p.purchase_price : 0;
  const net = (p.monthly_rent || 0) - (p.mortgage_monthly || 0);
  return { pays, lease, tenant, late, lateTotal, yieldGross, net, equity: (p.market_value || 0) };
}
export function portfolio() {
  const props = store.all('properties');
  const rented = props.filter((p) => p.status === 'מושכר');
  const rent = sum(rented, 'monthly_rent');
  const mortgage = sum(props, 'mortgage_monthly');
  const value = sum(props, 'market_value');
  const ym = thisMonth();
  const due = store.all('rent_payments').filter((x) => x.month === ym);
  const collected = sum(due, 'paid_amount');
  const expected = sum(due, 'amount');
  return { props, rented, rent, mortgage, value, occupancy: props.length ? rented.length / props.length : 0, collected, expected };
}

/* ---------- alerts (engine shared with the push cron: shared/alerts.ts) ---------- */
export type { Alert } from '../../shared/alerts';
export function alerts(): Alert[] {
  return computeAlerts((c) => store.all(c as Collection), { today: today(), money });
}

/* ---------- upcoming (next 14 days) ---------- */
export type Upcoming = { id: string; date: string; title: string; meta: string; area: Area; amount?: number; to: string };
export function upcoming(days = 14): Upcoming[] {
  const within = (d?: string) => d && daysUntil(d) >= 0 && daysUntil(d) <= days;
  const out: Upcoming[] = [];
  store.all('bills').filter((b) => within(b.next_due)).forEach((b) => out.push({ id: 'b' + b.id, date: b.next_due, title: b.name, meta: 'חשבון', area: 'home', amount: b.amount, to: '/home/bills' }));
  store.all('home_tasks').filter((t) => !t.done && within(t.due)).forEach((t) => out.push({ id: 't' + t.id, date: t.due, title: t.title, meta: 'משימת בית', area: 'home', to: '/home/tasks' }));
  store.all('events').filter((e) => within(e.date)).forEach((e) => out.push({ id: 'e' + e.id, date: e.date, title: e.title, meta: e.time ? `אירוע · ${e.time}` : 'אירוע', area: 'home', to: '/planner/week' }));
  store.all('rent_payments').filter((x) => within(x.due_date) && (x.paid_amount || 0) < x.amount).forEach((x) => {
    const p = store.get('properties', x.property_id);
    out.push({ id: 'r' + x.id, date: x.due_date, title: p?.name ?? 'נכס', meta: 'שכירות צפויה', area: 'invest', amount: x.amount, to: `/invest/${x.property_id}/payments` });
  });
  store.all('biz_tasks').filter((t) => !t.done && within(t.due)).forEach((t) => {
    const b = store.get('businesses', t.business_id);
    out.push({ id: 'bt' + t.id, date: t.due, title: t.title, meta: b?.name ?? 'עסק', area: 'business', to: `/business/${t.business_id}/tasks` });
  });
  store.all('invoices').filter((i) => invoiceState(i) === 'open' && within(i.due_date)).forEach((i) => {
    const b = store.get('businesses', i.business_id);
    out.push({ id: 'i' + i.id, date: i.due_date, title: `גבייה · ${i.client}`, meta: b?.name ?? '', area: 'business', amount: gross(i), to: `/business/${i.business_id}/invoices` });
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function sum(rows: Rec[], key: string) { return rows.reduce((a, r) => a + (Number(r[key]) || 0), 0); }
