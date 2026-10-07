import 'server-only';
import { db } from './db';
import { addDays, todayIL } from '@/lib/period';
import paramsLib from '@domain/params';
import { buyzReport, BUYZ_ERROR, type BuyzReport } from './buyz';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Head Spa Israel revenue. Stored months come from revenue_monthly (filled by the daily
// cron, the refresh button or `npm run buyz:apply`); this month's detail is read live.
// Buyz amounts include VAT; the page leads with ex-VAT. Revenue only: there is no profit here.

export type Basis = 'all' | 'mine';
export const parseBasis = (v: unknown): Basis => (v === 'mine' ? 'mine' : 'all');

export type OspaMonth = { month: string; incl_vat: number; ex_vat: number | null; tx_count: number | null };
export type OspaLocation = { location: string; name_he: string; months: OspaMonth[]; last_fetched: string | null };

const BRANCH = 'head-spa-israel';

export async function ospa(basis: Basis) {
  const today = todayIL();
  const { rows: params } = await db().query(
    `SELECT key, to_char(effective_from, 'YYYY-MM-DD') AS effective_from, value FROM parameters`);
  const share: number | null = (paramsLib.paramAt(params, `ownership_pct:${BRANCH}`, today) as any)?.pct ?? null;
  const vatNow: number | null = paramsLib.vatRateAt(params, today);
  // "My share" without an ownership parameter is unknown, not 100%
  const factor = basis === 'mine' ? share : 1;
  const scale = (v: number | null) => (v === null || factor === null ? null : v * factor);
  const exVat = (incl: number | null, rate: number | null) => (incl === null || rate === null ? null : incl / (1 + rate));

  let ready = true;
  let locations: OspaLocation[] = [];
  try {
    const { rows } = await db().query(`
      SELECT s.location, s.name_he, to_char(m.month, 'YYYY-MM-DD') AS month,
             m.revenue_total::float AS incl_vat, m.tx_count, m.fetched_at
      FROM revenue_sources s
      LEFT JOIN revenue_monthly m USING (source, source_account)
      WHERE s.branch = $1 AND s.active AND (m.month IS NULL OR m.month >= $2::date)
      ORDER BY s.location, m.month`, [BRANCH, `${addDays(today, -366).slice(0, 7)}-01`]);
    const byLoc = new Map<string, OspaLocation>();
    for (const r of rows) {
      const loc: OspaLocation = byLoc.get(r.location) ?? { location: r.location, name_he: r.name_he, months: [], last_fetched: null };
      if (r.month) {
        loc.months.push({ month: r.month, incl_vat: r.incl_vat, ex_vat: exVat(r.incl_vat, paramsLib.vatRateAt(params, r.month)), tx_count: r.tx_count });
        const f = new Date(r.fetched_at).toISOString();
        if (!loc.last_fetched || f > loc.last_fetched) loc.last_fetched = f;
      }
      byLoc.set(r.location, loc);
    }
    locations = [...byLoc.values()];
  } catch (e: any) {
    if (e?.code !== '42P01') throw e; // table missing → migration not applied yet
    ready = false;
  }

  // Business total per month (sum of locations), ex-VAT, in the chosen basis
  const totals = new Map<string, { incl: number; ex: number | null }>();
  for (const l of locations) for (const m of l.months) {
    const t = totals.get(m.month) ?? { incl: 0, ex: 0 };
    t.incl += m.incl_vat;
    t.ex = t.ex === null || m.ex_vat === null ? null : t.ex + m.ex_vat;
    totals.set(m.month, t);
  }
  const thisMonth = `${today.slice(0, 7)}-01`;
  const lastMonth = `${addDays(thisMonth, -1).slice(0, 7)}-01`;
  const monthly = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([month, t]) => ({ month, ex_vat: scale(t.ex), incl_vat: scale(t.incl) }));
  const pick = (m: string) => monthly.find(x => x.month === m) ?? null;
  const ytd = monthly.filter(m => m.month.slice(0, 4) === today.slice(0, 4));
  const sum = (xs: (number | null)[]) => (xs.length && xs.every(x => x !== null) ? xs.reduce((a, b) => a! + b!, 0) : null);

  // Live detail for this month (summary, methods, sales, daily). One Buyz key = one location for now.
  const live = await buyzReport({ period: 'this_month' });
  const report: BuyzReport | null = live.ok ? live.report : null;
  const liveScaled = report && {
    revenue_ex: scale(exVat(report.summary.revenue_total, vatNow)),
    revenue_incl: scale(report.summary.revenue_total),
    unpaid_incl: report.summary.unpaid_total,
    tx: report.summary.transactions_count,
    avg_incl: report.summary.average_transaction,
    by_source: report.summary.by_source,
    methods: report.methods,
    sales: report.sales,
    daily: report.daily,
  };

  return {
    today, basis, share, vat_rate: vatNow, ready,
    live_error: live.ok ? null : BUYZ_ERROR[live.reason],
    fetched_at: live.ok ? live.fetched_at : null,
    locations: locations.map(l => ({ location: l.location, name_he: l.name_he, last_fetched: l.last_fetched })),
    monthly,
    this_month: liveScaled?.revenue_ex ?? pick(thisMonth)?.ex_vat ?? null,
    this_month_incl: liveScaled?.revenue_incl ?? pick(thisMonth)?.incl_vat ?? null,
    last_month: pick(lastMonth)?.ex_vat ?? null,
    ytd: sum(ytd.map(m => m.ex_vat)),
    ytd_months: ytd.length,
    live: liveScaled,
  };
}
