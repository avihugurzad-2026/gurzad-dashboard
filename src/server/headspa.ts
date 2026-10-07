import 'server-only';
import { db } from './db';
import { canSeePlace, type SessionUser } from './auth';
import { loadLocations } from './locations';
import { addDays, todayIL } from '@/lib/period';
import { locationsOf } from '@/lib/places';
import paramsLib from '@domain/params';
import integrationsLib from '@domain/integrations';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Head Spa Israel (stage 3.1): every branch comes from the location registry and is read the same
// way, from the local tables the integration sync fills (no live provider call on page load).
// Amounts are stored as the source reports them (Buyz: incl. VAT); pages lead with ex-VAT.
// Revenue only: there is no profit here.

export const HEAD_SPA = 'head-spa-israel';
export type Basis = 'all' | 'mine';

export type Named = { name: string; count: number | null; total: number | null };
export type MonthSummary = {
  month: string; revenue_total: number | null; tx_count: number | null; average_transaction: number | null; unpaid_total: number | null;
  bookings_total: number | null; bookings_count: number | null; vouchers_total: number | null; vouchers_count: number | null;
  sales_total: number | null; sales_count: number | null; orders_count: number | null;
  customers_count: number | null; new_customers_count: number | null; cancellations_count: number | null; fetched_at: string;
};
export type BranchNumbers = {
  today_incl: number | null; today_ex: number | null; month_incl: number | null; month_ex: number | null;
  last_month_ex: number | null; ytd_ex: number | null; tx: number | null; bookings_count: number | null;
  customers: number | null; cancellations: number | null; unpaid_incl: number | null; avg_ticket_incl: number | null;
};
export type BranchIntegration = {
  provider: string; status: 'ok' | 'error' | 'disabled' | 'not_connected'; last_sync_at: string | null;
  last_error: string | null; amounts_include_vat: boolean | null;
};
export type BranchData = {
  location: string; name_he: string; status: 'active' | 'setup'; href: string;
  can_see_money: boolean;
  integration: BranchIntegration | null;
  has_data: boolean;
  as_of: string | null;                         // when the local numbers were last pulled
  numbers: BranchNumbers;
  this_month: MonthSummary | null; last_month: MonthSummary | null;
  monthly: { month: string; incl: number; ex: number | null; tx: number | null; bookings: number | null; vouchers: number | null; sales: number | null }[];
  daily: { day: string; incl: number; ex: number | null; tx: number | null }[];
  items: { this: Named[]; last: Named[] };
  staff: { this: Named[]; last: Named[] };
  methods: { method: string; label: string; count: number | null; total: number | null }[];
};

const EMPTY_NUMBERS: BranchNumbers = {
  today_incl: null, today_ex: null, month_incl: null, month_ex: null, last_month_ex: null, ytd_ex: null,
  tx: null, bookings_count: null, customers: null, cancellations: null, unpaid_incl: null, avg_ticket_incl: null,
};

const missing = (e: any) => e?.code === '42P01' || e?.code === '42703';
const f = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

async function q(sql: string, values: unknown[]): Promise<any[]> {
  try {
    return (await db().query(sql, values)).rows;
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

// All Head Spa branches this user may see (one, when `only` is given), with their numbers.
export async function headSpaData(u: SessionUser, basis: Basis = 'all', only: string | null = null) {
  await loadLocations();
  const today = todayIL();
  const thisMonth = `${today.slice(0, 7)}-01`;
  const lastMonth = `${addDays(thisMonth, -1).slice(0, 7)}-01`;
  const since = `${addDays(today, -400).slice(0, 7)}-01`;

  const regs = locationsOf(HEAD_SPA).filter(l => (only === null || l.id === only)
    && canSeePlace(u, { domain: 'business', branch: HEAD_SPA, location: l.id }));
  const money = new Set(regs.filter(l => canSeePlace(u, { domain: 'business', branch: HEAD_SPA, location: l.id }, 'money')).map(l => l.id));
  const locs = [...money];

  const [params, integ, months] = await Promise.all([
    q(`SELECT key, to_char(effective_from, 'YYYY-MM-DD') AS effective_from, value FROM parameters`, []),
    q(`SELECT id, provider, location, status, last_sync_at, last_error, config FROM integrations
       WHERE branch = $1 AND location = ANY($2::text[]) ORDER BY (status = 'disabled'), provider`, [HEAD_SPA, regs.map(l => l.id)]),
    locs.length ? q(`SELECT s.location, to_char(m.month, 'YYYY-MM-DD') AS month, m.revenue_total, m.tx_count, m.bookings, m.vouchers, m.sales,
                            s.amounts_include_vat, m.fetched_at
                     FROM revenue_monthly m JOIN revenue_sources s USING (source, source_account)
                     WHERE s.active AND s.branch = $1 AND s.location = ANY($2::text[]) AND m.month >= $3::date
                     ORDER BY m.month`, [HEAD_SPA, locs, since]) : Promise.resolve([]),
  ]);
  const share: number | null = (paramsLib.paramAt(params, `ownership_pct:${HEAD_SPA}`, today) as any)?.pct ?? null;
  const vatNow = paramsLib.vatRateAt(params, today);
  const factor = basis === 'mine' ? share : 1;
  const sc = (v: number | null) => (v === null || factor === null ? null : v * factor);

  // One integration per branch: the first that is not disabled
  const integByLoc = new Map<string, any>();
  for (const r of integ) if (!integByLoc.has(r.location)) integByLoc.set(r.location, r);
  const liveIds = [...integByLoc.values()].filter(r => r.status !== 'disabled' && money.has(r.location)).map(r => r.id);

  const [summaries, daily, items, staff, methods] = liveIds.length ? await Promise.all([
    q(`SELECT *, to_char(month, 'YYYY-MM-DD') AS month_iso FROM revenue_month_summary
       WHERE integration_id = ANY($1::uuid[]) AND month IN ($2::date, $3::date)`, [liveIds, thisMonth, lastMonth]),
    q(`SELECT integration_id, to_char(day, 'YYYY-MM-DD') AS day, revenue_total, tx_count FROM revenue_daily
       WHERE integration_id = ANY($1::uuid[]) AND day >= $2::date ORDER BY day`, [liveIds, thisMonth]),
    ...['revenue_items_monthly', 'revenue_staff_monthly'].map(t => q(
      `SELECT x.integration_id, to_char(x.month, 'YYYY-MM-DD') AS month, x.name, x.count, x.total FROM ${t} x
       JOIN revenue_month_summary s ON s.integration_id = x.integration_id AND s.month = x.month AND s.fetched_at = x.fetched_at
       WHERE x.integration_id = ANY($1::uuid[]) AND x.month IN ($2::date, $3::date)
       ORDER BY x.total DESC NULLS LAST, x.name`, [liveIds, thisMonth, lastMonth])),
    q(`SELECT x.integration_id, x.method, x.label, x.count, x.total FROM revenue_methods_monthly x
       JOIN revenue_month_summary s ON s.integration_id = x.integration_id AND s.month = x.month AND s.fetched_at = x.fetched_at
       WHERE x.integration_id = ANY($1::uuid[]) AND x.month = $2::date ORDER BY x.total DESC NULLS LAST`, [liveIds, thisMonth]),
  ]) : [[], [], [], [], []];

  const branches: BranchData[] = regs.map(l => {
    const ir = integByLoc.get(l.id) ?? null;
    const integration: BranchIntegration | null = ir && {
      provider: ir.provider, status: ir.status, last_sync_at: iso(ir.last_sync_at), last_error: ir.last_error,
      amounts_include_vat: typeof ir.config?.amounts_include_vat === 'boolean' ? ir.config.amounts_include_vat : null,
    };
    const base = { location: l.id, name_he: l.label, status: l.status, href: `/business/${HEAD_SPA}/${l.id}`, integration };
    if (!money.has(l.id)) {
      return { ...base, can_see_money: false, has_data: false, as_of: null, numbers: EMPTY_NUMBERS, this_month: null, last_month: null,
        monthly: [], daily: [], items: { this: [], last: [] }, staff: { this: [], last: [] }, methods: [] };
    }
    const mine = months.filter(m => m.location === l.id);
    const inclVat: boolean | null = integration?.amounts_include_vat ?? (mine[0] ? mine[0].amounts_include_vat : null);
    const exVat = (incl: number | null, date: string) => {
      if (incl === null || inclVat === null) return null;
      if (!inclVat) return incl;
      const rate = paramsLib.vatRateAt(params, date);
      return rate === null ? null : incl / (1 + rate);
    };
    const id = ir && ir.status !== 'disabled' ? ir.id : null;
    const sum = (m: any): MonthSummary => ({
      month: m.month_iso, revenue_total: f(m.revenue_total), tx_count: f(m.tx_count), average_transaction: f(m.average_transaction),
      unpaid_total: f(m.unpaid_total), bookings_total: f(m.bookings_total), bookings_count: f(m.bookings_count),
      vouchers_total: f(m.vouchers_total), vouchers_count: f(m.vouchers_count), sales_total: f(m.sales_total), sales_count: f(m.sales_count),
      orders_count: f(m.orders_count), customers_count: f(m.customers_count), new_customers_count: f(m.new_customers_count),
      cancellations_count: f(m.cancellations_count), fetched_at: iso(m.fetched_at)!,
    });
    const sThis = summaries.find(s => s.integration_id === id && s.month_iso === thisMonth);
    const sLast = summaries.find(s => s.integration_id === id && s.month_iso === lastMonth);
    const tm = sThis ? sum(sThis) : null, lm = sLast ? sum(sLast) : null;

    const monthly = mine.map(m => ({
      month: m.month, incl: Number(m.revenue_total), ex: exVat(Number(m.revenue_total), m.month), tx: f(m.tx_count),
      bookings: f(m.bookings), vouchers: f(m.vouchers), sales: f(m.sales),
    }));
    const days = daily.filter(d => d.integration_id === id).map(d => ({
      day: d.day, incl: Number(d.revenue_total), ex: exVat(Number(d.revenue_total), d.day), tx: f(d.tx_count),
    }));
    const todayRow = days.find(d => d.day === today) ?? null;
    const histThis = monthly.find(m => m.month === thisMonth) ?? null;
    const histLast = monthly.find(m => m.month === lastMonth) ?? null;
    const monthIncl = tm?.revenue_total ?? histThis?.incl ?? null;
    const tx = tm?.tx_count ?? histThis?.tx ?? null;
    const ytd = monthly.filter(m => m.month.slice(0, 4) === today.slice(0, 4));
    const ytdEx = ytd.length && ytd.every(m => m.ex !== null) ? ytd.reduce((a, m) => a + m.ex!, 0) : null;
    const lastEx = lm?.revenue_total != null ? exVat(lm.revenue_total, lastMonth) : histLast?.ex ?? null;
    const numbers: BranchNumbers = {
      today_incl: sc(todayRow?.incl ?? null), today_ex: sc(todayRow?.ex ?? null),
      month_incl: sc(monthIncl), month_ex: sc(exVat(monthIncl, thisMonth)),
      last_month_ex: sc(lastEx), ytd_ex: sc(ytdEx),
      tx, bookings_count: tm?.bookings_count ?? null, customers: tm?.customers_count ?? null,
      cancellations: tm?.cancellations_count ?? null, unpaid_incl: tm?.unpaid_total ?? null,
      avg_ticket_incl: tm?.average_transaction ?? (monthIncl !== null && tx ? monthIncl / tx : null),
    };
    const named = (rows: any[], month: string): Named[] =>
      rows.filter(r => r.integration_id === id && r.month === month).map(r => ({ name: r.name, count: f(r.count), total: f(r.total) }));
    const stamps = [tm?.fetched_at, ...mine.map(m => iso(m.fetched_at))].filter(Boolean) as string[];
    return {
      ...base, can_see_money: true,
      has_data: monthly.length > 0 || tm !== null || days.length > 0,
      as_of: stamps.length ? stamps.sort().at(-1)! : null,
      numbers, this_month: tm, last_month: lm, monthly, daily: days,
      items: { this: named(items, thisMonth), last: named(items, lastMonth) },
      staff: { this: named(staff, thisMonth), last: named(staff, lastMonth) },
      methods: methods.filter(m => m.integration_id === id).map(m => ({ method: m.method, label: m.label ?? m.method, count: f(m.count), total: f(m.total) })),
    };
  });

  // Company totals over the branches whose money this user may see
  const seen = branches.filter(b => b.can_see_money);
  const total = integrationsLib.aggregateBranches(seen.map(b => b.numbers));
  const byMonth = new Map<string, number | null>();
  for (const b of seen) for (const m of b.monthly) {
    const prev = byMonth.has(m.month) ? byMonth.get(m.month)! : 0;
    byMonth.set(m.month, prev === null || m.ex === null ? null : prev + m.ex);
  }
  const monthly = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, ex]) => ({ month, value: sc(ex) }));

  return { today, basis, share, vat_rate: vatNow, branches, total, monthly, can_see_money: seen.length > 0 };
}
export type HeadSpaData = Awaited<ReturnType<typeof headSpaData>>;

// For the Home business card: today's and this month's revenue per branch, 100% of the business.
// Amounts: ex-VAT (with the incl. VAT figure Buyz reported alongside). null = no data, never 0.
export async function headSpaSnapshot(u: SessionUser) {
  const d = await headSpaData(u, 'all');
  return {
    today: d.today,
    vat_rate: d.vat_rate,
    branches: d.branches.map(b => ({
      location: b.location, name_he: b.name_he, status: b.status, href: b.href,
      connected: b.integration !== null && b.integration.status !== 'disabled' && b.integration.status !== 'not_connected',
      can_see_money: b.can_see_money,
      today_ex: b.numbers.today_ex, today_incl: b.numbers.today_incl,
      month_ex: b.numbers.month_ex, month_incl: b.numbers.month_incl,
      as_of: b.as_of, last_sync_at: b.integration?.last_sync_at ?? null,
    })),
    total: { today_ex: d.total.today_ex, today_incl: d.total.today_incl, month_ex: d.total.month_ex, month_incl: d.total.month_incl },
  };
}
export type HeadSpaSnapshot = Awaited<ReturnType<typeof headSpaSnapshot>>;
