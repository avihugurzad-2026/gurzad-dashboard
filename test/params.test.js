'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const { vatRateAt, allocationThresholdAt } = require('../lib/params');
const kpi = require('../lib/kpi');

// Same values as migration 0003 / vault Parameters/
const rows = [
  { key: 'vat_rate', effective_from: '2015-10-01', value: { rate: 0.17 } },
  { key: 'vat_rate', effective_from: '2025-01-01', value: { rate: 0.18 } },
  { key: 'allocation_threshold', effective_from: '2024-05-01', value: { amount: 25000 } },
  { key: 'allocation_threshold', effective_from: '2025-01-01', value: { amount: 20000 } },
  { key: 'allocation_threshold', effective_from: '2026-01-01', value: { amount: 10000 } },
  { key: 'allocation_threshold', effective_from: '2026-06-01', value: { amount: 5000 } },
];

test('VAT rate switches 17% → 18% on 2025-01-01', () => {
  assert.equal(vatRateAt(rows, '2024-12-31'), 0.17);
  assert.equal(vatRateAt(rows, '2025-01-01'), 0.18);
});

test('allocation threshold switches 10,000 → 5,000 on 2026-06-01', () => {
  assert.equal(allocationThresholdAt(rows, '2026-05-31'), 10000);
  assert.equal(allocationThresholdAt(rows, '2026-06-01'), 5000);
  const inv = { type: 'invoice', amount_net: 7000 };
  assert.equal(kpi.allocationRequired(inv, allocationThresholdAt(rows, '2026-05-31')), false);
  assert.equal(kpi.allocationRequired(inv, allocationThresholdAt(rows, '2026-06-01')), true);
});

test('no parameter for the date → null, no hardcoded fallback', () => {
  assert.equal(vatRateAt(rows, '2010-01-01'), null);
  assert.equal(allocationThresholdAt([], '2026-10-07'), null);
});
