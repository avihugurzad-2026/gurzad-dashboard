import 'server-only';
import { db } from './db';
import { addDays, todayIL } from '@/lib/period';
import paramsLib from '@domain/params';
import type { BuyzReport } from './buyz';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Head Spa Israel revenue. Stored months come from revenue_monthly (filled by the daily
// cron, the refresh button or `npm run buyz:apply`); this month's detail is read live.
// Buyz amounts include VAT; the page leads with ex-VAT. Revenue only: there is no profit here.

export type Basis = 'all' | 'mine';
export const parseBasis = (v: unknown): Basis => (v === 'mine' ? 'mine' : 'all');

export type OspaMonth = { month: string; incl_vat: number; ex_vat: number | null; tx_count: number | null };
export type OspaLocation = { location: string; name_he: string; connected: boolean; months: OspaMonth[]; last_fetched: string | null };
type LiveDetail = {
  revenue_ex: number | null; revenue_incl: number | null; unpaid_incl: number | null;
  tx: number | null; avg_incl: number | null; by_source: BuyzReport['summary']['by_source'];
  methods: BuyzReport['methods']; sales: BuyzReport['sales']; daily: BuyzReport['daily'];
};
// Kept as a function so consumers retain the nullable compatibility shape while
// navigation remains database-only.
const storedLiveDetail = (): LiveDetail | null => null;

const BRANCH = 'head-spa-israel';

// location = one branch of the business (e.g. 'modiin'); null = the whole business
export async function ospa(basis: Basis, location: string | null = null) {
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
      SELECT l.location, l.name_he, (s.source IS NOT NULL) AS connected,
             to_char(m.month, 'YYYY-MM-DD') AS month,
             m.revenue_total::float AS incl_vat, m.tx_count, m.fetched_at
      FROM locations l
      LEFT JOIN revenue_sources s ON s.branch = l.branch AND s.location = l.location AND s.active
      LEFT JOIN revenue_monthly m ON m.source = s.source AND m.source_account = s.source_account AND m.month >= $2::date
      WHERE l.branch = $1 AND l.active AND ($3::text IS NULL OR l.location = $3)
      ORDER BY l.sort NULLS LAST, l.location, m.month`, [BRANCH, `${addDays(today, -366).slice(0, 7)}-01`, location]);
    const byLoc = new Map<string, OspaLocation>();
    for (const r of rows) {
      const loc: OspaLocation = byLoc.get(r.location) ?? { location: r.location, name_he: r.name_he, connected: r.connected, months: [], last_fetched: null };
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

  // Navigation is database-only. Buyz is refreshed by the protected cron and
  // the stored monthly figures remain available if the provider is unavailable.
  const liveScaled = storedLiveDetail();

  return {
    today, basis, share, vat_rate: vatNow, ready,
    live_error: null,
    fetched_at: null,
    locations: locations.map(l => {
      const lm = l.months.find(m => m.month === lastMonth)?.ex_vat ?? null;
      const ly = l.months.filter(m => m.month.slice(0, 4) === today.slice(0, 4));
      return { location: l.location, name_he: l.name_he, connected: l.connected, has_data: l.months.length > 0, last_fetched: l.last_fetched,
        last_month: scale(lm), ytd: scale(sum(ly.map(m => m.ex_vat))) };
    }),
    monthly,
    this_month: liveScaled?.revenue_ex ?? pick(thisMonth)?.ex_vat ?? null,
    this_month_incl: liveScaled?.revenue_incl ?? pick(thisMonth)?.incl_vat ?? null,
    last_month: pick(lastMonth)?.ex_vat ?? null,
    ytd: sum(ytd.map(m => m.ex_vat)),
    ytd_months: ytd.length,
    live: liveScaled,
  };
}
