// External revenue (Buyz → Head Spa Israel locations). Monthly rows per location,
// stored as the source reports them (Buyz: incl. VAT), plus monthly KPI snapshots
// per branch in two bases: 100% of the business and avihu's share.
// Revenue only: Buyz has no expenses, so nothing here is profit.
'use strict';

const { paramAt, vatRateAt } = require('./params');
const { writeSnapshots } = require('./snapshots');

const BUYZ_ENDPOINT = 'https://buyz.co.il/api/revenue.php';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const x = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(x) ? x : null;
}
const round2 = x => Math.round(x * 100) / 100;

// Raw Buyz response → { account, months[] }. Months without a total are left out (no data, not 0).
function normalizeBuyz(raw) {
  if (!raw || raw.success === false) throw new Error(`Buyz error: ${raw?.error ?? 'empty response'}`);
  const account = raw.supplier?.id;
  if (account === undefined || account === null) throw new Error('Buyz response has no supplier.id');
  const months = [];
  for (const m of Array.isArray(raw.monthly) ? raw.monthly : []) {
    if (!/^\d{4}-\d{2}$/.test(String(m.month))) continue;
    const total = num(m.revenue_total);
    if (total === null) continue;
    months.push({
      month: `${m.month}-01`, revenue_total: total, tx_count: num(m.count),
      bookings: num(m.bookings), vouchers: num(m.vouchers), sales: num(m.sales),
    });
  }
  // Months before the location's first sale are "not open yet", not ₪0 months
  const first = months.findIndex(m => m.revenue_total !== 0 || (m.tx_count ?? 0) !== 0);
  return { account: String(account), name: raw.supplier?.name ?? null, months: first === -1 ? [] : months.slice(first) };
}

// Only summary + monthly: never `transactions` (customer names)
async function fetchBuyz({ key, query, fetchImpl = fetch }) {
  if (!key) throw new Error('BUYZ_API_KEY not set');
  const url = new URL(BUYZ_ENDPOINT);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  url.searchParams.set('include', 'summary,monthly');
  const res = await fetchImpl(url, { headers: { 'X-API-Key': key, Accept: 'application/json' } });
  const raw = await res.json().catch(() => null);
  if (!res.ok && !raw) throw new Error(`Buyz HTTP ${res.status}`);
  return raw;
}

const FIELDS = ['revenue_total', 'tx_count', 'bookings', 'vouchers', 'sales'];
const same = (a, b) => FIELDS.every(f => (a[f] === null ? null : Number(a[f])) === (b[f] === null ? null : Number(b[f])));

// Upsert months for one account. An unchanged month is left alone; a changed one keeps its
// old values in revenue_monthly_history. With dry=true nothing is written.
async function upsertMonths(client, source, { account, months }, { dry = false } = {}) {
  const { rows: src } = await client.query(
    `SELECT 1 FROM revenue_sources WHERE source = $1 AND source_account = $2 AND active`, [source, account]);
  if (!src.length) throw new Error(`Unmapped ${source} account ${account}: add it to revenue_sources`);

  const { rows: existing } = await client.query(
    `SELECT to_char(month, 'YYYY-MM-DD') AS month, ${FIELDS.join(', ')}
     FROM revenue_monthly WHERE source = $1 AND source_account = $2`, [source, account]);
  const byMonth = new Map(existing.map(r => [r.month, r]));

  const out = { added: 0, changed: 0, unchanged: 0 };
  for (const m of months) {
    const old = byMonth.get(m.month);
    if (old && same(old, m)) { out.unchanged++; continue; }
    out[old ? 'changed' : 'added']++;
    if (dry) continue;
    if (old) {
      await client.query(
        `INSERT INTO revenue_monthly_history (source, source_account, month, ${FIELDS.join(', ')})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [source, account, m.month, ...FIELDS.map(f => old[f])]);
    }
    await client.query(
      `INSERT INTO revenue_monthly (source, source_account, month, ${FIELDS.join(', ')}, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (source, source_account, month) DO UPDATE SET
         revenue_total = EXCLUDED.revenue_total, tx_count = EXCLUDED.tx_count,
         bookings = EXCLUDED.bookings, vouchers = EXCLUDED.vouchers, sales = EXCLUDED.sales,
         fetched_at = now()`,
      [source, account, m.month, ...FIELDS.map(f => m[f])]);
  }
  return out;
}

// rows: [{ domain, branch, month: 'YYYY-MM-DD', revenue_total, amounts_include_vat }] summed per branch.
// A month with no VAT parameter is skipped (never guessed); my_share needs an ownership parameter.
function buildRevenueSnapshots(rows, params) {
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.domain}|${r.branch}|${r.month}`;
    const rate = r.amounts_include_vat ? vatRateAt(params, r.month) : 0;
    if (rate === null) continue;
    const exVat = Number(r.revenue_total) / (1 + rate);
    const cur = byKey.get(k) ?? { domain: r.domain, branch: r.branch, month: r.month, value: 0 };
    cur.value += exVat;
    byKey.set(k, cur);
  }
  const out = [];
  for (const c of byKey.values()) {
    const period = c.month.slice(0, 7);
    const base = { period, kpi_key: 'revenue', domain: c.domain, branch: c.branch, vat_basis: 'ex_vat' };
    out.push({ ...base, basis: 'group_100', value: round2(c.value) });
    const pct = paramAt(params, `ownership_pct:${c.branch}`, c.month)?.pct;
    if (typeof pct === 'number') out.push({ ...base, basis: 'my_share', value: round2(c.value * pct) });
  }
  return out.sort((a, b) => (a.period + a.basis).localeCompare(b.period + b.basis));
}

// Fetch → store → snapshot, in one transaction. query: { months: N } or { from, to }.
async function ingestBuyz(pool, { key, query, dry = false, fetchImpl }) {
  const data = normalizeBuyz(await fetchBuyz({ key, query, fetchImpl }));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counts = await upsertMonths(client, 'buyz', data, { dry });
    const { rows } = await client.query(
      `SELECT s.domain, s.branch, to_char(m.month, 'YYYY-MM-DD') AS month, m.revenue_total, s.amounts_include_vat
       FROM revenue_monthly m JOIN revenue_sources s USING (source, source_account) WHERE s.active`);
    const { rows: params } = await client.query(
      `SELECT key, to_char(effective_from, 'YYYY-MM-DD') AS effective_from, value FROM parameters`);
    const snaps = buildRevenueSnapshots(rows, params);
    if (!dry) await writeSnapshots(client, snaps);
    await client.query(dry ? 'ROLLBACK' : 'COMMIT');
    return { account: data.account, months: data.months.length, ...counts, snapshots: snaps.length, dry };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { normalizeBuyz, fetchBuyz, upsertMonths, buildRevenueSnapshots, ingestBuyz };
