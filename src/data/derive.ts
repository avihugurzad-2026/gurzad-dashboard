import type { Area, Rec } from './types';
import { store } from './store';
import { daysUntil, monthsBack, thisMonth, today, money, relDay } from '../lib/format';

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
export function bizSeries(bizId: string, n = 6) {
  const inv = store.all('invoices').filter((i) => i.business_id === bizId && i.status !== 'בוטלה' && i.status !== 'טיוטה');
  const exp = store.all('biz_expenses').filter((e) => e.business_id === bizId);
  return monthsBack(n).map((m) => {
    const income = sum(inv.filter((i) => (i.issue_date || '').startsWith(m)), 'amount_net');
    const expense = sum(exp.filter((e) => (e.date || '').startsWith(m)), 'amount_net');
    return { month: m, income, expense, profit: income - expense };
  });
}
export function bizSummary(bizId: string) {
  const inv = store.all('invoices').filter((i) => i.business_id === bizId);
  const open = inv.filter((i) => ['open', 'overdue'].includes(invoiceState(i)));
  const overdue = inv.filter((i) => invoiceState(i) === 'overdue');
  const series = bizSeries(bizId);
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

/* ---------- alerts ---------- */
export type Alert = { id: string; level: 'danger' | 'warn' | 'info'; area: Area; title: string; detail: string; to: string; sort: number };

export function alerts(): Alert[] {
  const out: Alert[] = [];
  const push = (a: Alert) => out.push(a);

  // home
  store.all('home_tasks').filter((t) => !t.done && t.due && daysUntil(t.due) < 0).forEach((t) =>
    push({ id: 'ht' + t.id, level: 'warn', area: 'home', title: t.title, detail: `משימת בית באיחור · ${relDay(t.due)}`, to: '/home/tasks', sort: daysUntil(t.due) }));
  store.all('bills').filter((b) => daysUntil(b.next_due) <= 3).forEach((b) =>
    push({ id: 'b' + b.id, level: daysUntil(b.next_due) < 0 ? 'danger' : 'warn', area: 'home', title: `${b.name} · ${money(b.amount)}`, detail: `חשבון לתשלום ${relDay(b.next_due)}`, to: '/home/bills', sort: daysUntil(b.next_due) }));
  store.all('documents').filter((d) => d.expires && daysUntil(d.expires) <= 14).forEach((d) =>
    push({ id: 'd' + d.id, level: daysUntil(d.expires) < 0 ? 'danger' : 'warn', area: 'home', title: d.title, detail: `פג תוקף ${relDay(d.expires)}`, to: '/home/documents', sort: daysUntil(d.expires) }));
  const hm = homeMonth();
  hm.byCat.filter((c) => c.budget && c.spent > c.budget).forEach((c) =>
    push({ id: 'bud' + c.category, level: 'warn', area: 'home', title: `חריגה בתקציב · ${c.category}`, detail: `${money(c.spent)} מתוך ${money(c.budget)}`, to: '/home/budget', sort: 5 }));

  // business
  store.all('businesses').forEach((b) => {
    const s = bizSummary(b.id);
    s.overdue.forEach((i) => push({ id: 'io' + i.id, level: daysUntil(i.due_date) < -30 ? 'danger' : 'warn', area: 'business', title: `${b.name} · ${i.client}`, detail: `חשבונית ${i.number} באיחור ${-daysUntil(i.due_date)} ימים · ${money(gross(i))}`, to: `/business/${b.id}/invoices`, sort: daysUntil(i.due_date) }));
    s.missingAlloc.forEach((i) => push({ id: 'ia' + i.id, level: 'danger', area: 'business', title: `${b.name} · חסר מספר הקצאה`, detail: `חשבונית ${i.number} · ${i.client}`, to: `/business/${b.id}/invoices`, sort: -100 }));
    store.all('biz_tasks').filter((t) => t.business_id === b.id && !t.done && t.due && daysUntil(t.due) < 0).forEach((t) =>
      push({ id: 'bt' + t.id, level: 'warn', area: 'business', title: `${b.name} · ${t.title}`, detail: `משימה באיחור · ${relDay(t.due)}`, to: `/business/${b.id}/tasks`, sort: daysUntil(t.due) }));
  });

  // investments — driven by user-defined rules
  const rules = store.all('alert_rules').filter((r) => r.enabled);
  const rule = (k: string) => rules.find((r) => r.kind === k);
  store.all('properties').forEach((p) => {
    const m = propMetrics(p);
    const late = rule('איחור בתשלום שכירות');
    if (late) m.late.filter((x) => -daysUntil(x.due_date) >= (late.threshold ?? 0)).forEach((x) =>
      push({ id: 'rp' + x.id, level: 'danger', area: 'invest', title: `${p.name} · שכירות לא שולמה`, detail: `${money(x.amount - (x.paid_amount || 0))} · ${-daysUntil(x.due_date)} ימים באיחור`, to: `/invest/${p.id}/payments`, sort: daysUntil(x.due_date) }));
    const le = rule('סיום חוזה מתקרב');
    if (le && m.lease && daysUntil(m.lease.end) <= (le.threshold ?? 90) && daysUntil(m.lease.end) >= -30)
      push({ id: 'le' + p.id, level: daysUntil(m.lease.end) <= 30 ? 'danger' : 'warn', area: 'invest', title: `${p.name} · חוזה מסתיים`, detail: `בעוד ${daysUntil(m.lease.end)} ימים — זמן לחדש או לחפש שוכר`, to: `/invest/${p.id}/lease`, sort: daysUntil(m.lease.end) });
    const ins = rule('ביטוח מבנה פג');
    if (ins && p.insurance_until && daysUntil(p.insurance_until) <= (ins.threshold ?? 30))
      push({ id: 'in' + p.id, level: 'warn', area: 'invest', title: `${p.name} · ביטוח מבנה`, detail: `פג ${relDay(p.insurance_until)}`, to: `/invest/${p.id}`, sort: daysUntil(p.insurance_until) });
    const ot = rule('משימה פתוחה זמן רב');
    if (ot) store.all('prop_tasks').filter((t) => t.property_id === p.id && !t.done && t.due && -daysUntil(t.due) >= (ot.threshold ?? 7)).forEach((t) =>
      push({ id: 'pt' + t.id, level: 'warn', area: 'invest', title: `${p.name} · ${t.title}`, detail: `פתוחה ${-daysUntil(t.due)} ימים אחרי היעד`, to: `/invest/${p.id}/tasks`, sort: daysUntil(t.due) }));
    const vac = rule('נכס פנוי');
    if (vac && p.status === 'פנוי')
      push({ id: 'va' + p.id, level: 'warn', area: 'invest', title: `${p.name} · עומד ריק`, detail: 'אין שוכר פעיל', to: `/invest/${p.id}`, sort: 0 });
  });

  const rank = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.sort - b.sort);
}

/* ---------- upcoming (next 14 days) ---------- */
export type Upcoming = { id: string; date: string; title: string; meta: string; area: Area; amount?: number; to: string };
export function upcoming(days = 14): Upcoming[] {
  const within = (d?: string) => d && daysUntil(d) >= 0 && daysUntil(d) <= days;
  const out: Upcoming[] = [];
  store.all('bills').filter((b) => within(b.next_due)).forEach((b) => out.push({ id: 'b' + b.id, date: b.next_due, title: b.name, meta: 'חשבון', area: 'home', amount: b.amount, to: '/home/bills' }));
  store.all('home_tasks').filter((t) => !t.done && within(t.due)).forEach((t) => out.push({ id: 't' + t.id, date: t.due, title: t.title, meta: 'משימת בית', area: 'home', to: '/home/tasks' }));
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
