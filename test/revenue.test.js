'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const r      = require('../lib/revenue');

// Synthetic numbers, same shape as the live response
const raw = {
  success: true, supplier: { id: 7, name: 'ספא דמו' },
  summary: { revenue_total: 2180, by_source: { bookings: { total: 2000, count: 5 } } },
  monthly: [
    { month: '2026-08', revenue_total: 1180, count: 4, bookings: 1000, vouchers: 180, sales: 0 },
    { month: '2026-09', revenue_total: '1,000', count: 2, bookings: 1000, vouchers: null, sales: null },
    { month: '2026-10', revenue_total: null, count: 0 },
    { month: 'bad' },
  ],
};

test('normalizeBuyz: months as first-of-month, no-total months left out, never 0', () => {
  const n = r.normalizeBuyz(raw);
  assert.equal(n.account, '7');
  assert.deepEqual(n.months.map(m => [m.month, m.revenue_total]), [['2026-08-01', 1180], ['2026-09-01', 1000]]);
  assert.equal(n.months[1].vouchers, null);
});

test('normalizeBuyz: API error is thrown, not stored', () => {
  assert.throws(() => r.normalizeBuyz({ success: false, error: 'missing_api_key' }), /missing_api_key/);
  assert.throws(() => r.normalizeBuyz({ success: true, monthly: [] }), /supplier/);
});

const params = [
  { key: 'vat_rate', effective_from: '2015-10-01', value: { rate: 0.17 } },
  { key: 'vat_rate', effective_from: '2025-01-01', value: { rate: 0.18 } },
  { key: 'ownership_pct:head-spa-israel', effective_from: '2000-01-01', value: { pct: 0.5 } },
];
const row = (month, total, extra = {}) => ({ domain: 'business', branch: 'head-spa-israel', month, revenue_total: total, amounts_include_vat: true, ...extra });

test('snapshots: ex-VAT with the dated rate, 100% and my share, locations summed per branch', () => {
  const out = r.buildRevenueSnapshots([row('2026-09-01', 1180), row('2026-09-01', 2360)], params);
  assert.deepEqual(out.map(s => [s.period, s.basis, s.value, s.vat_basis]), [
    ['2026-09', 'group_100', 3000, 'ex_vat'],
    ['2026-09', 'my_share', 1500, 'ex_vat'],
  ]);
  const old = r.buildRevenueSnapshots([row('2024-12-01', 1170)], params);
  assert.equal(old[0].value, 1000);   // 17% before 2025
});

test('snapshots: no VAT parameter → month skipped; no ownership → no my_share row', () => {
  assert.deepEqual(r.buildRevenueSnapshots([row('2010-01-01', 1000)], params), []);
  const out = r.buildRevenueSnapshots([row('2026-09-01', 1180, { branch: 'other' })], params);
  assert.deepEqual(out.map(s => s.basis), ['group_100']);
});

test('fetch sends the key in X-API-Key, never in the URL, and never asks for transactions', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url: String(url), init }; return { ok: true, json: async () => raw }; };
  const out = await r.fetchBuyz({ key: 'k_test', query: { months: 3 }, fetchImpl });
  assert.equal(out, raw);
  assert.equal(seen.init.headers['X-API-Key'], 'k_test');
  assert.ok(!seen.url.includes('k_test'));
  assert.match(seen.url, /months=3&include=summary%2Cmonthly$/);
  await assert.rejects(r.fetchBuyz({ key: '', query: {}, fetchImpl }), /BUYZ_API_KEY/);
});
