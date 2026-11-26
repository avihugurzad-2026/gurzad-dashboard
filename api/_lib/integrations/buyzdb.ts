import dns from 'node:dns/promises';
import net from 'node:net';
import mysql from 'mysql2/promise';
import { HttpError } from '../server.js';
import type { Adapter } from './index.js';

// Buyz database, read-only MySQL user. Queries follow the Buyz data guide from Buyz's developer (kept in the project files, not in the repo):
// always filtered by supplier_id and a date range, aggregated here, never copying secrets tables.
// The DB host must allow connections from Vercel (dynamic IPs), so the read-only user is created for host '%'.

function isPrivate(ip: string) {
  if (net.isIPv6(ip)) return ip === '::1' || /^f[cd]|^fe80/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224;
}

async function connect(config: Record<string, string>, password: string) {
  const host = (config.host || '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new HttpError(400, 'כתובת שרת לא תקינה');
  const port = Number(config.port || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'פורט לא תקין');
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new HttpError(400, 'כתובת שרת לא מורשית');
  } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(424, 'לא נמצא שרת בכתובת הזו'); }
  const base = { host, port, user: config.user, password, database: config.database, connectTimeout: 10000, dateStrings: true, charset: 'utf8mb4' };
  try {
    return await mysql.createConnection({ ...base, ssl: { rejectUnauthorized: false } });
  } catch {
    try { return await mysql.createConnection(base); } // shared hosts often have no TLS on MySQL
    catch (e: any) {
      const code = String(e?.code || '');
      if (code === 'ER_ACCESS_DENIED_ERROR') throw new HttpError(424, 'המסד דחה את שם המשתמש או הסיסמה, או שהשרת לא מאשר חיבור מכתובת ה־IP של הדשבורד (צריך לאשר host % למשתמש הזה).');
      if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED') throw new HttpError(424, 'השרת לא עונה בפורט הזה. כנראה שצריך לפתוח גישה מרחוק (Remote MySQL) לכל כתובת.');
      throw new HttpError(424, `החיבור למסד נכשל (${code || 'שגיאה'})`);
    }
  }
}

const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const str = (v: unknown) => (v == null ? '' : String(v));
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Israel-local calendar dates for the windows we read. */
function windows() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const iso = (d: Date) => `${ym(d)}-${String(d.getDate()).padStart(2, '0')}`;
  const first = (k: number) => new Date(now.getFullYear(), now.getMonth() + k, 1);
  return { today: iso(now), monthFrom: iso(first(0)), lastFrom: iso(first(-1)), lastTo: iso(new Date(now.getFullYear(), now.getMonth(), 0)), sixFrom: iso(first(-5)), nextMonth: iso(first(1)), tomorrow: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) };
}

type Q = (sql: string, params?: unknown[]) => Promise<any[]>;

async function revenueByMonth(q: Q, sid: number, from: string, toExcl: string) {
  // Same rules as the Buyz portal (guide §5): invoices, not credited, not voucher redemptions, + external providers.
  const rows = await q(`
    SELECT DATE_FORMAT(d, '%Y-%m') AS m, SUM(amount) AS total FROM (
      SELECT i.created_at AS d, i.amount
      FROM invoices i
      LEFT JOIN bookings b ON b.id = i.booking_id AND b.supplier_id = i.supplier_id
      WHERE i.supplier_id = ? AND i.kind = 'invoice'
        AND NOT EXISTS (SELECT 1 FROM invoices c WHERE c.refund_of = i.id AND c.kind IN ('credit_invoice','credit_receipt'))
        AND COALESCE(b.voucher_id, 0) = 0
        AND i.created_at >= ? AND i.created_at < ?
      UNION ALL
      SELECT COALESCE(updated_at, created_at), amount FROM payments
      WHERE supplier_id = ? AND type = 'booking' AND payment_method = 'external_provider' AND status = 'completed'
        AND COALESCE(updated_at, created_at) >= ? AND COALESCE(updated_at, created_at) < ?
    ) x GROUP BY m ORDER BY m`, [sid, from, toExcl, sid, from, toExcl]);
  return Object.fromEntries(rows.map((r: any) => [str(r.m), num(r.total)]));
}

async function staffPeriod(q: Q, sid: number, from: string, toExcl: string) {
  const [sold, treated, cart, hours] = await Promise.all([
    // who closed the sale (created_at = when it was sold)
    q(`SELECT COALESCE(au.display_name, b.created_by_username) AS name, b.created_by_username AS u, COUNT(*) AS n, SUM(b.total_price) AS total
       FROM bookings b LEFT JOIN admin_users au ON au.username = b.created_by_username
       WHERE b.supplier_id = ? AND b.status IN ('confirmed','completed') AND b.created_at >= ? AND b.created_at < ?
       GROUP BY b.created_by_username, au.display_name`, [sid, from, toExcl]),
    // who performed the treatment (booking_date = when it happened)
    q(`SELECT tm.full_name AS name, tm.portal_username AS u, COUNT(*) AS n, SUM(b.total_price) AS total
       FROM bookings b JOIN team_members tm ON tm.id = b.team_member_id
       WHERE b.supplier_id = ? AND b.status IN ('confirmed','completed') AND b.booking_date >= ? AND b.booking_date < ?
       GROUP BY tm.id, tm.full_name, tm.portal_username`, [sid, from, toExcl]),
    q(`SELECT tm.full_name AS name, tm.portal_username AS u, COUNT(*) AS n, SUM(o.total_amount) AS total
       FROM staff_cart_orders o JOIN team_members tm ON tm.id = o.team_member_id
       WHERE o.supplier_id = ? AND o.status = 'paid' AND o.created_at >= ? AND o.created_at < ?
       GROUP BY tm.id, tm.full_name, tm.portal_username`, [sid, from, toExcl]),
    q(`SELECT tm.full_name AS name, tm.portal_username AS u,
              SUM(TIME_TO_SEC(TIMEDIFF(s.end_time, s.start_time)) + IF(s.end_time < s.start_time, 86400, 0)) / 3600 AS h
       FROM team_shifts s JOIN team_members tm ON tm.id = s.team_member_id
       WHERE s.supplier_id = ? AND s.status = 'approved' AND s.shift_date >= ? AND s.shift_date < ?
         AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL
         AND (s.source IN ('punch','manual') OR (s.source IS NULL AND DATE(s.created_at) >= s.shift_date))
       GROUP BY tm.id, tm.full_name, tm.portal_username`, [sid, from, toExcl]),
  ]);
  // Merge by person: portal username when known, else name. NULL seller = sold online.
  const m = new Map<string, any>();
  const row = (key: string, name: string) => { if (!m.has(key)) m.set(key, { name, sold: 0, soldCount: 0, treatments: 0, treatmentsValue: 0, products: 0, productsCount: 0, hours: 0 }); return m.get(key); };
  for (const r of treated) { const x = row(str(r.u) || 'n:' + str(r.name), str(r.name)); x.treatments = num(r.n); x.treatmentsValue = num(r.total); }
  for (const r of cart) { const x = row(str(r.u) || 'n:' + str(r.name), str(r.name)); x.products = num(r.total); x.productsCount = num(r.n); }
  for (const r of hours) { const x = row(str(r.u) || 'n:' + str(r.name), str(r.name)); x.hours = Math.round(num(r.h) * 10) / 10; }
  for (const r of sold) { const key = str(r.u) || 'online'; const x = row(key, key === 'online' ? 'אונליין' : str(r.name) || key); x.sold = num(r.total); x.soldCount = num(r.n); }
  return [...m.values()].sort((a, b) => (b.sold + b.products) - (a.sold + a.products) || b.treatmentsValue - a.treatmentsValue);
}

async function expensesByMonth(q: Q, sid: number, months: string[], revenue: Record<string, number>, from: string, toExcl: string) {
  const [items, parts] = await Promise.all([
    q('SELECT * FROM supplier_fixed_expenses WHERE supplier_id = ?', [sid]),
    q(`SELECT DATE_FORMAT(booking_date, '%Y-%m') AS m, SUM(COALESCE(participant_count, 1)) AS p
       FROM bookings WHERE supplier_id = ? AND status IN ('confirmed','completed') AND booking_date >= ? AND booking_date < ?
       GROUP BY m`, [sid, from, toExcl]),
  ]);
  const participants: Record<string, number> = Object.fromEntries(parts.map((r: any) => [str(r.m), num(r.p)]));
  const active = items.filter((e: any) => e.is_active == null || num(e.is_active) === 1);
  const lines = active.map((e: any) => ({ label: str(e.label) || 'הוצאה', calc: str(e.calc_type), amount: num(e.amount), rate: num(e.rate) }));
  const byMonth = months.map((month) => {
    let total = 0;
    for (const l of lines) {
      if (l.calc === 'per_participant') total += (l.rate || l.amount) * (participants[month] ?? 0);
      else if (l.calc === 'percent') total += ((l.rate || l.amount) / 100) * (revenue[month] ?? 0);
      else total += l.amount; // fixed_monthly
    }
    return { month, total: Math.round(total) };
  });
  return { byMonth, lines };
}

export const buyzdb: Adapter = {
  async test(config, secret) {
    const c = await connect(config, secret);
    try {
      const [rows]: any = await c.query('SELECT id, name FROM suppliers WHERE slug = ? LIMIT 1', [config.slug || 'ospa']);
      if (!rows[0]) throw new HttpError(424, `לא נמצא עסק עם הכינוי "${config.slug || 'ospa'}" ב־Buyz`);
      return `החיבור תקין · ${rows[0].name}`;
    } finally { await c.end().catch(() => null); }
  },
  async sync(config, secret) {
    const c = await connect(config, secret);
    const q: Q = async (sql, params = []) => (await c.query(sql, params))[0] as any[];
    try {
      const [sup] = await q('SELECT id FROM suppliers WHERE slug = ? LIMIT 1', [config.slug || 'ospa']);
      if (!sup) throw new HttpError(424, 'העסק לא נמצא ב־Buyz');
      const sid = num(sup.id);
      const w = windows();
      const months = Array.from({ length: 6 }, (_, k) => { const d = new Date(w.sixFrom + 'T12:00:00'); d.setMonth(d.getMonth() + k); return ym(d); });
      const revenue = await revenueByMonth(q, sid, w.sixFrom, w.nextMonth);
      const [expenses, today, thisMonth, lastMonth, bookings, leads] = await Promise.all([
        expensesByMonth(q, sid, months, revenue, w.sixFrom, w.nextMonth),
        staffPeriod(q, sid, w.today, w.tomorrow),
        staffPeriod(q, sid, w.monthFrom, w.nextMonth),
        staffPeriod(q, sid, w.lastFrom, w.monthFrom),
        q(`SELECT status, COUNT(*) AS n, SUM(booking_date = ?) AS today, SUM(booking_date > ?) AS upcoming
           FROM bookings WHERE supplier_id = ? AND booking_date >= ? AND booking_date < ? GROUP BY status`, [w.today, w.today, sid, w.monthFrom, w.nextMonth]),
        q(`SELECT COALESCE(ls.label, l.source, 'ללא מקור') AS source, COUNT(*) AS n
           FROM supplier_leads l LEFT JOIN supplier_lead_sources ls ON ls.supplier_id = l.supplier_id AND ls.source_key = l.source
           WHERE l.supplier_id = ? AND l.created_at >= ? AND l.created_at < ? GROUP BY source ORDER BY n DESC`, [sid, w.monthFrom, w.nextMonth]),
      ]);
      const st = Object.fromEntries(bookings.map((r: any) => [str(r.status), { n: num(r.n), today: num(r.today), upcoming: num(r.upcoming) }]));
      return {
        ops: {
          months, revenue, expenses,
          staff: { today, thisMonth, lastMonth },
          bookings: {
            today: (st.confirmed?.today ?? 0) + (st.completed?.today ?? 0),
            upcoming: (st.confirmed?.upcoming ?? 0) + (st.pending?.upcoming ?? 0),
            done: st.completed?.n ?? 0, cancelled: st.cancelled?.n ?? 0, noShow: st.no_show?.n ?? 0,
          },
          leads: leads.map((r: any) => ({ source: str(r.source), count: num(r.n) })),
        },
      };
    } finally { await c.end().catch(() => null); }
  },
};
