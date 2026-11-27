import { HttpError } from '../server.js';
import { BUYZ_SQL } from './buyzSql.js';

// Named, read-only queries against the Buyz database, written from the Buyz data guide (Buyz's developer):
// always filtered by supplier_id and a date range, aggregated, never touching secrets tables.
// The same list is exported to PHP (scripts/gen-buyz-php.mjs → dashboard_ops.php) so it can run on the
// Buyz server itself when the database port is closed to the outside. Params are positional (?).

export { BUYZ_SQL };

export type QueryName = keyof typeof BUYZ_SQL;
export type Run = (name: QueryName, params?: unknown[]) => Promise<any[]>;

const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const str = (v: unknown) => (v == null ? '' : String(v));
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const SECRET = /key|secret|token|pass|hash|otp|cookie|session/i;

function windows() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const iso = (d: Date) => `${ym(d)}-${String(d.getDate()).padStart(2, '0')}`;
  const first = (k: number) => new Date(now.getFullYear(), now.getMonth() + k, 1);
  return {
    today: iso(now), tomorrow: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)),
    monthFrom: iso(first(0)), lastFrom: iso(first(-1)), sixFrom: iso(first(-5)), nextMonth: iso(first(1)),
  };
}

async function staffPeriod(run: Run, sid: number, from: string, toExcl: string) {
  const p = [sid, from, toExcl];
  const [sold, treated, cart, hours] = await Promise.all([run('sold', p), run('treated', p), run('cart', p), run('hours', p)]);
  // Merge by person: portal username when known, else name. NULL seller = sold online.
  const m = new Map<string, any>();
  const row = (key: string, name: string) => { if (!m.has(key)) m.set(key, { name, sold: 0, soldCount: 0, treatments: 0, treatmentsValue: 0, products: 0, productsCount: 0, hours: 0 }); return m.get(key); };
  for (const r of treated) { const x = row(str(r.u) || 'n:' + str(r.name), str(r.name)); x.treatments = num(r.n); x.treatmentsValue = num(r.total); }
  for (const r of cart) { const x = row(str(r.u) || 'n:' + str(r.name), str(r.name)); x.products = num(r.total); x.productsCount = num(r.n); }
  for (const r of hours) { const x = row(str(r.u) || 'n:' + str(r.name), str(r.name)); x.hours = Math.round(num(r.h) * 10) / 10; }
  for (const r of sold) { const key = str(r.u) || 'online'; const x = row(key, key === 'online' ? 'אונליין' : str(r.name) || key); x.sold = num(r.total); x.soldCount = num(r.n); }
  return [...m.values()].sort((a, b) => (b.sold + b.products) - (a.sold + a.products) || b.treatmentsValue - a.treatmentsValue);
}

export async function buyzTest(run: Run, slug: string) {
  const [s] = await run('supplier', [slug]);
  if (!s) throw new HttpError(424, `לא נמצא עסק עם הכינוי "${slug}" ב־Buyz`);
  return `החיבור תקין · ${s.name}`;
}

/** Everything the dashboard shows for one Buyz business: ops snapshot + discovery of sibling branches. */
export async function buyzSync(run: Run, slug: string) {
  const [sup] = await run('supplier', [slug]);
  if (!sup) throw new HttpError(424, 'העסק לא נמצא ב־Buyz');
  const sid = num(sup.id);
  const w = windows();
  const months = Array.from({ length: 6 }, (_, k) => { const d = new Date(w.sixFrom + 'T12:00:00'); d.setMonth(d.getMonth() + k); return ym(d); });
  const revRows = await run('revenueByMonth', [sid, w.sixFrom, w.nextMonth, sid, w.sixFrom, w.nextMonth]);
  const revenue: Record<string, number> = Object.fromEntries(revRows.map((r: any) => [str(r.m), num(r.total)]));
  const [items, parts, today, thisMonth, lastMonth, bookings, leads, network, ownerRows] = await Promise.all([
    run('fixedExpenses', [sid]),
    run('participants', [sid, w.sixFrom, w.nextMonth]),
    staffPeriod(run, sid, w.today, w.tomorrow),
    staffPeriod(run, sid, w.monthFrom, w.nextMonth),
    staffPeriod(run, sid, w.lastFrom, w.monthFrom),
    run('bookings', [w.today, w.today, sid, w.monthFrom, w.nextMonth]),
    run('leads', [sid, w.monthFrom, w.nextMonth]),
    run('network', [sid]).catch(() => []),
    run('ownerBusinesses').catch(() => []),
  ]);
  const participants: Record<string, number> = Object.fromEntries(parts.map((r: any) => [str(r.m), num(r.p)]));
  const lines = items.filter((e: any) => e.is_active == null || num(e.is_active) === 1)
    .map((e: any) => ({ label: str(e.label) || 'הוצאה', calc: str(e.calc_type), amount: num(e.amount), rate: num(e.rate) }));
  const byMonth = months.map((month) => {
    let total = 0;
    for (const l of lines) {
      if (l.calc === 'per_participant') total += (l.rate || l.amount) * (participants[month] ?? 0);
      else if (l.calc === 'percent') total += ((l.rate || l.amount) / 100) * (revenue[month] ?? 0);
      else total += l.amount; // fixed_monthly
    }
    return { month, total: Math.round(total) };
  });
  const st = Object.fromEntries(bookings.map((r: any) => [str(r.status), { n: num(r.n), today: num(r.today), upcoming: num(r.upcoming) }]));
  return {
    ops: {
      months, revenue, expenses: { byMonth, lines },
      staff: { today, thisMonth, lastMonth },
      bookings: {
        today: (st.confirmed?.today ?? 0) + (st.completed?.today ?? 0),
        upcoming: (st.confirmed?.upcoming ?? 0) + (st.pending?.upcoming ?? 0),
        done: st.completed?.n ?? 0, cancelled: st.cancelled?.n ?? 0, noShow: st.no_show?.n ?? 0,
      },
      leads: leads.map((r: any) => ({ source: str(r.source), count: num(r.n) })),
    },
    discovery: {
      self: { id: sid, slug },
      network: network.map((r: any) => ({ id: num(r.id), name: str(r.name), slug: str(r.slug) })),
      ownerBusinesses: ownerRows.map((r: any) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET.test(k)).map(([k, v]) => [k, v == null ? null : String(v).slice(0, 120)]))),
    },
  };
}
