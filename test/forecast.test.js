'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const f      = require('../lib/forecast');

const today = '2026-10-07'; // Wednesday; forecast week 1 starts Monday 2026-10-05
const base = {
  todayIso: today, vatRate: 0.18, floorMonths: 1.5,
  cashAccounts: [
    { cash_class: 'operating',  balance: 10000, balance_date: '2026-10-06' },
    { cash_class: 'restricted', balance: 50000, balance_date: '2026-10-06', restricted_reason: 'vat_reserve' },
  ],
  receivables: [], retainers: [],
  commitments: [{ payee: 'שכירות', amount: 4000, vat_included: true, frequency: 'monthly', next_due: '2026-10-10' }],
};

test('restricted cash is shown separately and not counted in opening/floor', () => {
  const r = f.buildForecast(base);
  assert.equal(r.cash.operating, 10000);
  assert.equal(r.cash.restricted, 50000);
  assert.equal(r.weeks[0].closing, 6000); // 10,000 − rent 4,000 (restricted 50,000 not used)
});

test('trough week, floor and below-floor flag', () => {
  const r = f.buildForecast({ ...base, receivables: [{ client: 'א', due_date: '2026-10-20', amount_gross: 3000 }] });
  // rent on 10/10, 11/10, 12/10 → 10,000 − 12,000 + 3,000 = 1,000 at the end
  assert.equal(r.trough.amount, 1000);
  assert.equal(r.trough.week, r.weeks.find(w => w.start <= '2026-12-10' && '2026-12-10' <= f.addDaysIso(w.start, 6)).start);
  assert.equal(r.floor, 6000);            // 1.5 × 4,000 a month
  assert.equal(r.below_floor, true);
});

test('negative balance: trough below zero is reported as is', () => {
  const r = f.buildForecast({ ...base, cashAccounts: [{ cash_class: 'operating', balance: 1000, balance_date: today }] });
  assert.equal(r.trough.amount, -11000);
});

test('no cash-account → no closing/trough; marked partial', () => {
  const r = f.buildForecast({ ...base, cashAccounts: [] });
  assert.equal(r.trough, null);
  assert.equal(r.weeks[0].closing, null);
  assert.equal(r.partial, true);
  assert.ok(r.missing.some(m => m.key === 'cash_account'));
});

test('receivables without due_date are not placed on a guessed week', () => {
  const r = f.buildForecast({ ...base, receivables: [{ amount_gross: 76504 }] });
  assert.equal(r.weeks.reduce((s, w) => s + w.in, 0), 0);
  assert.deepEqual(r.missing.find(m => m.key === 'receivable_due_date'), { key: 'receivable_due_date', count: 1, amount: 76504, text: '1 חובות בלי due_date לא נכנסו לתחזית' });
});

test('overdue receivable lands in week 1; late-collection scenario shifts it 30 days', () => {
  const input = { ...base, receivables: [{ client: 'א', due_date: '2026-09-01', amount_gross: 5000 }] };
  assert.equal(f.buildForecast(input).weeks[0].in, 5000);
  const late = f.buildForecast(input, 'late_collection');
  assert.equal(late.weeks[0].in, 5000); // 2026-10-01 is still before the window
  const later = f.buildForecast({ ...base, receivables: [{ client: 'א', due_date: '2026-10-08', amount_gross: 5000 }] }, 'late_collection');
  assert.equal(later.weeks[0].in, 0);
  assert.equal(later.weeks[4].in, 5000); // 2026-11-07, week of 2026-11-02
});

test('retainers: scheduled ones flow in incl. VAT; lose-top-client removes the biggest', () => {
  const input = { ...base, retainers: [
    { client: 'גדול', status: 'active', amount_net: 5000, billing_day: 1, payment_terms_days: 0 },
    { client: 'קטן',  status: 'active', amount_net: 1000, billing_day: 1, payment_terms_days: 0 },
    { client: 'בלי לוח', status: 'active', amount_net: 2000 },
  ] };
  const r = f.buildForecast(input);
  const totalIn = r.weeks.reduce((s, w) => s + w.in, 0);
  assert.equal(totalIn, 3 * 6000 * 1.18); // Nov 1, Dec 1, Jan 1 inside the 13 weeks
  assert.ok(r.missing.some(m => m.key === 'retainer_schedule'));
  const lose = f.buildForecast(input, 'lose_top_client');
  assert.equal(lose.weeks.reduce((s, w) => s + w.in, 0), 3 * 1000 * 1.18);
});

test('weeks of spend = operating cash ÷ average weekly outflow', () => {
  const r = f.buildForecast(base);
  assert.equal(r.weeks_of_spend, Math.round(10000 / (12000 / 13) * 10) / 10);
  assert.equal(f.buildForecast({ ...base, commitments: [] }).weeks_of_spend, null);
});

test('commitment without VAT is grossed up with the VAT rate', () => {
  const r = f.buildForecast({ ...base, commitments: [{ amount: 1000, vat_included: false, frequency: 'once', next_due: '2026-10-08' }] });
  assert.equal(r.weeks[0].out, 1180);
});
