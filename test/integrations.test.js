'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const I      = require('../lib/integrations');

// Synthetic numbers in the documented Buyz shape. Includes a `transactions` list and a customer
// array on purpose: neither may end up in the mapped rows.
const detail = (account = 1) => ({
  success: true, supplier: { id: account, name: 'ספא דמו' },
  summary: {
    revenue_total: '11,800', transactions_count: 40, average_transaction: 295, unpaid_total: 590,
    by_source: { bookings: { total: 9440, count: 32 }, vouchers: { total: 1180, count: 4 }, sales: { total: 1180, count: 6 } },
    customers: [{ name: 'לקוחה פרטית', phone: '050' }],
  },
  daily: [
    { date: '2026-10-01', revenue_total: 5900, count: 20, bookings: 4720 },
    { date: '2026-10-02', revenue_total: '5,900', count: 20 },
    { date: '2026-09-30', revenue_total: 100, count: 1 },     // other month: dropped
    { date: '2026-10-03', revenue_total: null, count: 0 },    // no total: no row (not 0)
  ],
  by_payment_method: [{ method: 'credit', label: 'אשראי', count: 30, total: 8850 }, { method: 'credit', total: 1 }],
  sales: {
    orders_count: 6, total: 1180, average_order: 196.67,
    top_items: [{ name: 'שמפו', count: 4, total: 800 }, { title: 'מסכה', qty: 2, revenue: 380 }],
    by_seller: [{ name: 'דנה', count: 3, total: 600 }, { seller: 'רוני', count: 3, total: 580 }],
  },
  transactions: [{ customer_name: 'לא אמור להישמר', amount: 295 }],
});

test('mapBuyzMonth: summary, daily in month only, items/staff/methods; no customer data, no invented numbers', () => {
  const m = I.mapBuyzMonth(detail(), '2026-10');
  assert.equal(m.account, '1');
  assert.equal(m.summary.month, '2026-10-01');
  assert.equal(m.summary.revenue_total, 11800);
  assert.equal(m.summary.bookings_count, 32);
  assert.equal(m.summary.orders_count, 6);
  assert.equal(m.summary.customers_count, null);       // an array of people is not a count
  assert.equal(m.summary.cancellations_count, null);   // not returned → null, never 0
  assert.deepEqual(m.daily.map(d => [d.day, d.revenue_total]), [['2026-10-01', 5900], ['2026-10-02', 5900]]);
  assert.deepEqual(m.items.map(i => [i.name, i.count, i.total]), [['שמפו', 4, 800], ['מסכה', 2, 380]]);
  assert.deepEqual(m.staff.map(i => i.name), ['דנה', 'רוני']);
  assert.equal(m.methods.length, 1);
  const flat = JSON.stringify(m);
  assert.ok(!flat.includes('לקוחה') && !flat.includes('לא אמור'), 'no personal data in mapped rows');
});

test('mapBuyzMonth: aggregate customer/cancellation numbers are kept when Buyz sends them', () => {
  const raw = detail();
  raw.summary.customers_count = 25; raw.summary.cancellations_count = '3';
  const m = I.mapBuyzMonth(raw, '2026-10');
  assert.equal(m.summary.customers_count, 25);
  assert.equal(m.summary.cancellations_count, 3);
});

test('mapBuyzMonth: errors and wrong shapes are rejected', () => {
  assert.throws(() => I.mapBuyzMonth({ success: false, error: 'x' }, '2026-10'), e => e.code === 'bad_response');
  assert.throws(() => I.mapBuyzMonth({ success: true }, '2026-10'), e => e.code === 'bad_response');
});

test('resolveCredential: env only, only the provider variable names, never another secret', () => {
  const env = { BUYZ_API_KEY: 'k1', BUYZ_API_KEY_JERUSALEM: 'k2', JWT_SECRET: 's' };
  assert.equal(I.resolveCredential('buyz', 'env:BUYZ_API_KEY', env), 'k1');
  assert.equal(I.resolveCredential('buyz', 'env:BUYZ_API_KEY_JERUSALEM', env), 'k2');
  assert.throws(() => I.resolveCredential('buyz', 'env:JWT_SECRET', env), e => e.code === 'bad_ref');
  assert.throws(() => I.resolveCredential('buyz', 'k1', env), e => e.code === 'bad_ref');
  assert.throws(() => I.resolveCredential('buyz', null, env), e => e.code === 'no_ref');
  assert.throws(() => I.resolveCredential('buyz', 'env:BUYZ_API_KEY', {}), e => e.code === 'no_key' && !/k1/.test(e.message));
});

test('monthRange / prevMonth', () => {
  assert.deepEqual(I.monthRange('2026-10', '2026-10-07'), { from: '2026-10-01', to: '2026-10-07' });
  assert.deepEqual(I.monthRange('2026-09', '2026-10-07'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(I.monthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
  assert.equal(I.prevMonth('2026-01'), '2025-12');
});

test('aggregateBranches: sums what exists, null when nobody has it, average ticket from revenue/tx', () => {
  const a = I.aggregateBranches([
    { today_incl: 1000, month_incl: 10000, tx: 40, bookings_count: 30, customers: null },
    { today_incl: null, month_incl: 5000, tx: 10, bookings_count: null, customers: null },
    { },
  ]);
  assert.equal(a.today_incl, 1000);
  assert.equal(a.month_incl, 15000);
  assert.equal(a.bookings_count, 30);
  assert.equal(a.customers, null);
  assert.equal(a.cancellations, null);
  assert.equal(a.avg_ticket_incl, 300);
  assert.equal(a.branches_with_data, 2);
  assert.equal(I.aggregateBranches([]).avg_ticket_incl, null);
});

test('goalsProgress: done count and average progress of measured active goals', () => {
  assert.equal(I.goalsProgress([]), null);
  const g = I.goalsProgress([
    { status: 'done', target: 10, current: 10 },
    { status: 'active', target: 100, current: 50 },
    { status: 'active', target: 10, current: 20 },   // capped at 100%
    { status: 'active', target: null, current: null },
    { status: 'dropped', target: 1, current: 0 },
  ]);
  assert.deepEqual(g, { total: 4, done: 1, active: 3, avg_pct: 0.75 });
});

// ── Sync with a fake pool and a mocked fetch (no network, no real key) ──────────
function fakePool({ historyRows = 0 } = {}) {
  const log = [];
  const run = async (sql, values = []) => {
    log.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
    if (/COUNT\(\*\)::int AS n FROM revenue_monthly/.test(sql)) return { rows: [{ n: historyRows }] };
    if (/SELECT 1 FROM revenue_sources/.test(sql)) return { rows: [{ '?column?': 1 }] };
    return { rows: [] };
  };
  return { log, query: run, connect: async () => ({ query: run, release() {} }) };
}

function mockFetch(account = 1) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(String(url));
    calls.push({ url: String(url), headers: init.headers });
    if (u.searchParams.get('include') === 'summary,monthly') {
      return { ok: true, status: 200, json: async () => ({ success: true, supplier: { id: account }, monthly: [{ month: '2026-09', revenue_total: 1180, count: 4 }] }) };
    }
    const raw = detail(account);
    if (u.searchParams.get('from') === '2026-09-01') raw.daily = [{ date: '2026-09-15', revenue_total: 100, count: 1 }];
    return { ok: true, status: 200, json: async () => raw };
  };
  return { calls, fetchImpl };
}

const INTEG = { id: 'i-1', provider: 'buyz', domain: 'business', branch: 'head-spa-israel', location: 'modiin',
  credentials_ref: 'env:BUYZ_API_KEY', config: { source_account: '1', amounts_include_vat: true } };
const SECRET = 'k_test_never_logged';

test('syncBuyz: pulls months + last/this month detail, upserts, status ok, one activity_log row with counts only', async () => {
  const pool = fakePool();
  const { calls, fetchImpl } = mockFetch();
  const r = await I.syncBuyz(pool, INTEG, { env: { BUYZ_API_KEY: SECRET }, fetchImpl, today: '2026-10-07', userId: null });
  assert.equal(r.ok, true);
  assert.equal(r.months_added, 1);
  assert.equal(r.months_detail, 2);
  assert.equal(r.days, 3);
  assert.equal(r.staff, 4);
  // key only in the header, never in a URL; never asks for transactions
  for (const c of calls) {
    assert.equal(c.headers['X-API-Key'], SECRET);
    assert.ok(!c.url.includes(SECRET));
    assert.ok(!/transactions/.test(c.url));
  }
  assert.ok(calls.some(c => /from=2026-10-01&to=2026-10-07/.test(c.url)));
  assert.match(calls.find(c => /months=24/.test(c.url)).url, /months=24/);   // empty history → 24-month backfill
  const writes = pool.log.map(l => l.sql);
  assert.ok(writes.some(s => s.startsWith('INSERT INTO revenue_month_summary')));
  assert.ok(writes.some(s => s.startsWith('INSERT INTO revenue_staff_monthly')));
  assert.ok(writes.some(s => /^UPDATE integrations SET status = \$2, last_error = \$3, updated_at = now\(\), last_sync_at = now\(\)/.test(s)));
  const act = pool.log.filter(l => l.sql.startsWith('INSERT INTO activity_log'));
  assert.equal(act.length, 1);
  const meta = JSON.parse(act[0].values[2]);
  assert.equal(meta.status, 'ok');
  assert.equal(meta.location, 'modiin');
  // Nothing written anywhere carries the key or a customer's name
  const all = JSON.stringify(pool.log);
  assert.ok(!all.includes(SECRET));
  assert.ok(!all.includes('לקוחה') && !all.includes('לא אמור'));
});

test('syncBuyz: missing key → status error, last_sync_at untouched, logged without the key', async () => {
  const pool = fakePool();
  const { calls, fetchImpl } = mockFetch();
  const r = await I.syncBuyz(pool, INTEG, { env: {}, fetchImpl, today: '2026-10-07' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no_key');
  assert.equal(calls.length, 0);
  const upd = pool.log.find(l => l.sql.startsWith('UPDATE integrations'));
  assert.ok(!/last_sync_at/.test(upd.sql));
  assert.deepEqual(upd.values.slice(1), ['error', I.ERROR_TEXT.no_key]);
  assert.equal(JSON.parse(pool.log.find(l => l.sql.startsWith('INSERT INTO activity_log')).values[2]).error_code, 'no_key');
});

test('syncBuyz: a key that belongs to another Buyz account is refused (no data under the wrong branch)', async () => {
  const pool = fakePool({ historyRows: 5 });
  const { fetchImpl } = mockFetch(99);
  const r = await I.syncBuyz(pool, INTEG, { env: { BUYZ_API_KEY: SECRET }, fetchImpl, today: '2026-10-07' });
  assert.equal(r.ok, false);
  assert.ok(['account_mismatch', 'unmapped'].includes(r.code));
  assert.ok(!pool.log.some(l => l.sql.startsWith('INSERT INTO revenue_month_summary')));
});

test('syncBuyz: unauthorized and bad config', async () => {
  const pool = fakePool();
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ success: false, error: 'invalid_api_key' }) });
  const r = await I.syncBuyz(pool, INTEG, { env: { BUYZ_API_KEY: SECRET }, fetchImpl, today: '2026-10-07' });
  assert.equal(r.code, 'unauthorized');
  const r2 = await I.syncBuyz(fakePool(), { ...INTEG, config: { source_account: '1' } }, { env: { BUYZ_API_KEY: SECRET }, fetchImpl, today: '2026-10-07' });
  assert.equal(r2.code, 'bad_config');   // amounts_include_vat is never guessed
});

test('syncAll: skips nothing but disabled rows (filtered in SQL) and runs each provider row', async () => {
  const pool = fakePool();
  const q = pool.query;
  pool.query = async (sql, v) => (/FROM integrations/.test(sql) && /status <> 'disabled'/.test(sql) ? { rows: [INTEG] } : q(sql, v));
  const { fetchImpl } = mockFetch();
  const out = await I.syncAll(pool, { env: { BUYZ_API_KEY: SECRET }, fetchImpl, today: '2026-10-07' });
  assert.equal(out.length, 1);
  assert.equal(out[0].ok, true);
});
