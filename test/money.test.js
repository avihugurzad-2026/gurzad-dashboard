'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../lib/money');
const { vatRateAt } = require('../lib/params');

const params = [
  { key: 'vat_rate', effective_from: '2015-10-01', value: { rate: 0.17 } },
  { key: 'vat_rate', effective_from: '2025-01-01', value: { rate: 0.18 } },
];

test('VAT inside a gross amount uses the rate of the date', () => {
  assert.deepEqual(m.vatSplit(1180, vatRateAt(params, '2025-01-01'), true), { gross: 1180, vat: 180, net: 1000 });
  assert.deepEqual(m.vatSplit(1170, vatRateAt(params, '2024-12-31'), true), { gross: 1170, vat: 170, net: 1000 });
  assert.deepEqual(m.vatSplit(100, 0.18, true), { gross: 100, vat: 15.25, net: 84.75 });
});

test('no VAT included → vat 0, net = gross; included without a rate → null', () => {
  assert.deepEqual(m.vatSplit(250, 0.18, false), { gross: 250, vat: 0, net: 250 });
  assert.deepEqual(m.vatSplit(250, null, false), { gross: 250, vat: 0, net: 250 });
  assert.equal(m.vatSplit(250, null, true), null);
  assert.equal(m.vatSplit(250, vatRateAt(params, '2010-01-01'), true), null);
});

test('parseAmount accepts "1,234.50", rejects zero, negatives, 3 decimals and text', () => {
  assert.equal(m.parseAmount('1,234.50'), 1234.5);
  assert.equal(m.parseAmount('₪ 99'), 99);
  for (const bad of ['0', '-5', '1.234', 'abc', '', null, '1e5']) assert.equal(m.parseAmount(bad), null, String(bad));
});

test('tax id: digits only, 5–9', () => {
  assert.ok(m.validTaxId('515123456'));
  assert.ok(m.validTaxId('12345'));
  assert.ok(!m.validTaxId('1234'));
  assert.ok(!m.validTaxId('1234567890'));
  assert.ok(!m.validTaxId('51-512345'));
});

test('splits must sum to 100 with unique users', () => {
  assert.ok(m.validSplits([{ user_id: 'avihu', share_pct: 50 }, { user_id: 'eden', share_pct: 50 }]));
  assert.ok(m.validSplits([{ user_id: 'avihu', share_pct: 33.33 }, { user_id: 'eden', share_pct: 66.67 }]));
  assert.ok(!m.validSplits([{ user_id: 'avihu', share_pct: 60 }, { user_id: 'eden', share_pct: 50 }]));
  assert.ok(!m.validSplits([{ user_id: 'avihu', share_pct: 50 }, { user_id: 'avihu', share_pct: 50 }]));
  assert.ok(!m.validSplits([{ user_id: 'avihu', share_pct: 100 }]));
  assert.ok(!m.validSplits([{ user_id: 'avihu', share_pct: 0 }, { user_id: 'eden', share_pct: 100 }]));
});

test('receivable status: overdue is computed from the due date', () => {
  const today = '2026-10-07';
  assert.deepEqual(m.receivableView({ amount: 1000, amount_paid: 0, due_date: '2026-09-30', status: 'pending' }, today),
    { status: 'overdue', remaining: 1000, days_overdue: 7 });
  assert.deepEqual(m.receivableView({ amount: 1000, amount_paid: 400, due_date: '2026-10-10', status: 'partial' }, today),
    { status: 'partial', remaining: 600, days_overdue: null });
  assert.deepEqual(m.receivableView({ amount: 1000, amount_paid: 0, due_date: '2026-10-07', status: 'pending' }, today),
    { status: 'pending', remaining: 1000, days_overdue: null });
  assert.equal(m.receivableView({ amount: 1000, amount_paid: 1000, due_date: '2026-01-01', status: 'paid' }, today).status, 'paid');
});

test('applyPayment: partial, full, too much', () => {
  assert.deepEqual(m.applyPayment(1000, 0, 400), { amount_paid: 400, status: 'partial', remaining: 600 });
  assert.deepEqual(m.applyPayment('1000.00', '400.00', 600), { amount_paid: 1000, status: 'paid', remaining: 0 });
  assert.deepEqual(m.applyPayment(1000, 400, 600.01), { error: 'too_much' });
  assert.deepEqual(m.applyPayment(1000, 1000, 1), { error: 'already_paid' });
  assert.deepEqual(m.applyPayment(1000, 0, 0), { error: 'invalid' });
});

test('CSV: BOM, CRLF, quoting and formula-injection guard', () => {
  const csv = m.toCsv(['a', 'b'], [['=SUM(A1)', 'say "hi"'], ['-5', null], ['+1', '@x'], ['\tt', 'שלום, עולם']]);
  assert.ok(csv.startsWith('﻿"a","b"\r\n'));
  assert.ok(csv.includes(`"'=SUM(A1)","say ""hi"""\r\n`));
  assert.ok(csv.includes(`"'-5",""\r\n`));
  assert.ok(csv.includes(`"'+1","'@x"\r\n`));
  assert.ok(csv.includes(`"'\tt","שלום, עולם"\r\n`));
  assert.ok(csv.endsWith('\r\n'));
});
