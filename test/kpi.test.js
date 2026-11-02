'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const kpi    = require('../lib/kpi');

test('MRR: Σ active retainer fees ex-VAT; inactive ignored', () => {
  const rs = [
    { status: 'active', amount_net: 2000 },
    { status: 'active', monthly_fee_net: 3000 },
    { status: 'paused', amount_net: 9999 },
  ];
  assert.equal(kpi.mrr(rs), 5000);
});

test('MRR: no retainers → null (not 0)', () => {
  assert.equal(kpi.mrr([]), null);
  assert.equal(kpi.mrr([{ status: 'ended', amount_net: 100 }]), null);
});

test('open debts: incl. VAT, minus paid, closed statuses excluded; none → null', () => {
  const ds = [
    { amount_gross: 1180 },
    { amount_gross: 5900, paid_amount: 900 },
    { amount_gross: 300, status: 'paid' },
    { amount_gross: 200, status: 'void' },
  ];
  assert.equal(kpi.openDebtsGross(ds), 6180);
  assert.equal(kpi.openDebtsGross([]), null);
});

test('aging: buckets by days past due, incl. VAT', () => {
  const today = '2026-10-07';
  const items = [
    { due_date: '2026-10-10', amount_gross: 100 },   // not yet due
    { due_date: '2026-10-07', amount_gross: 50 },    // due today → current
    { due_date: '2026-10-06', amount_gross: 200 },   // 1 day
    { due_date: '2026-09-07', amount_gross: 300 },   // 30 days
    { due_date: '2026-09-06', amount_gross: 400 },   // 31 days
    { due_date: '2026-07-09', amount_gross: 500 },   // 90 days
    { due_date: '2026-07-08', amount_gross: 600 },   // 91 days
    { due_date: '2026-01-01', amount_gross: 999, status: 'paid' },
    { amount_gross: 700 },                           // no due_date
  ];
  const r = kpi.aging(items, today);
  assert.deepEqual(r.buckets, { current: 150, d1_30: 500, d31_60: 400, d61_90: 500, d90_plus: 600 });
  assert.equal(r.missing_due_date, 1);
});

test('aging: no due_date anywhere → null ("אין נתונים", BUILD-SPEC §7)', () => {
  assert.equal(kpi.aging([{ amount_gross: 76504 }], '2026-10-07'), null);
});

test('VAT: amount, gross, estimate; missing rate → null', () => {
  assert.equal(kpi.vatAmount(20000, 0.18), 3600);
  assert.equal(kpi.grossFromNet(20000, 0.18), 23600);
  assert.equal(kpi.grossFromNet(20000, null), null);
  assert.equal(kpi.vatEstimate(
    [{ amount_net: 10000, vat_rate: 0.18 }, { vat_amount: 900 }],
    [{ amount_net: 1000, vat_rate: 0.18 }]
  ), 2520);
  assert.equal(kpi.vatEstimate([], []), null);
});

test('allocation_required at the threshold boundary (4,999 / 5,000 / 5,001)', () => {
  const inv = net => ({ type: 'invoice', amount_net: net });
  assert.equal(kpi.allocationRequired(inv(4999), 5000), false);
  assert.equal(kpi.allocationRequired(inv(5000), 5000), false);
  assert.equal(kpi.allocationRequired(inv(5001), 5000), true);
});

test('allocation_required: only tax invoices; unknown threshold → null', () => {
  assert.equal(kpi.allocationRequired({ type: 'retainer', amount_net: 9000 }, 5000), null);
  assert.equal(kpi.allocationRequired({ type: 'invoice', amount_net: 9000 }, null), null);
});

test('concentration: top-3 share of MRR; none → null', () => {
  const rs = [
    { status: 'active', client: 'א', amount_net: 5000 },
    { status: 'active', client: 'ב', amount_net: 3000 },
    { status: 'active', client: 'ג', amount_net: 1000 },
    { status: 'active', client: 'ד', amount_net: 1000 },
  ];
  const c = kpi.concentration(rs);
  assert.equal(c.max_pct, 50);
  assert.equal(c.total_clients, 4);
  assert.deepEqual(c.top_3.map(r => r.name), ['א', 'ב', 'ג']);
  assert.equal(kpi.concentration([]), null);
});
