'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../lib/ventures');

test('annuity payment: standard Spitzer formula, zero rate, bad input → null', () => {
  // 1,000,000 at 4.8% over 25 years: P·i / (1 − (1+i)^−n), i = 0.004
  assert.equal(v.monthlyPayment(1000000, 0.048, 300), 5729.97);
  assert.equal(v.monthlyPayment(120000, 0, 120), 1000);
  assert.equal(v.monthlyPayment(null, 0.04, 120), null);
  assert.equal(v.monthlyPayment(100000, 0.04, 0), null);
  assert.equal(v.monthlyPayment(100000, 1.2, 120), null);
});

test('a repayment splits into interest (balance × rate / 12) and principal', () => {
  const s = v.splitPayment(800000, 0.045, 5000);
  assert.deepEqual(s, { interest: 3000, principal: 2000, balance_after: 798000 });
  // less than the interest: all interest, balance unchanged
  assert.deepEqual(v.splitPayment(800000, 0.045, 1000), { interest: 1000, principal: 0, balance_after: 800000 });
  // the last payment closes the loan
  assert.deepEqual(v.splitPayment(1000, 0.06, 1005), { interest: 5, principal: 1000, balance_after: 0 });
  assert.deepEqual(v.splitPayment(1000, 0.06, 2000), { error: 'too_much' });
  assert.deepEqual(v.splitPayment(0, 0.06, 100), { error: 'paid_off' });
  assert.deepEqual(v.splitPayment(1000, 0.06, 0), { error: 'invalid' });
});

test('amortization schedule pays the loan off in its term and interest falls each month', () => {
  const pay = v.monthlyPayment(240000, 0.05, 120);
  const s = v.amortizationSchedule(240000, 0.05, pay, 1000, '2026-01-31');
  assert.equal(s.never_ends, false);
  assert.equal(s.rows.length, 120);
  assert.equal(s.rows.at(-1).balance, 0);
  assert.ok(s.rows[1].interest < s.rows[0].interest);
  assert.equal(s.rows[0].interest, 1000);
  assert.equal(s.rows[0].date, '2026-01-31');
  assert.equal(s.rows[1].date, '2026-02-28');       // end of a short month
  assert.equal(v.monthsToPayoff(240000, 0.05, pay), 120);
  // a payment that never covers the interest never ends
  assert.equal(v.amortizationSchedule(240000, 0.05, 900, 12, null).never_ends, true);
  assert.equal(v.monthsToPayoff(240000, 0.05, 900), null);
});

test('a repayment is split between the venture and personal side by the loan share', () => {
  assert.deepEqual(v.shareSplit(5000, 100), { venture: 5000, personal: 0 });
  assert.deepEqual(v.shareSplit(5000, 60), { venture: 3000, personal: 2000 });
  assert.deepEqual(v.shareSplit(3333.33, 50), { venture: 1666.67, personal: 1666.66 });
  assert.equal(v.shareSplit(5000, 120), null);
});

test('acceptance: a property with a loan shows its repayments and yields correctly', () => {
  // Bought for 1,500,000 with a 900,000 loan (4.5%, 25y). Rent 4,500 × 12, expenses 6,000 a year.
  const pay = v.monthlyPayment(900000, 0.045, 300);
  assert.equal(pay, 5002.49);
  let balance = 900000, interest = 0, principal = 0;
  for (let m = 0; m < 12; m++) {
    const s = v.splitPayment(balance, 0.045, pay);
    interest += s.interest; principal += s.principal; balance = s.balance_after;
  }
  interest = v.round2(interest); principal = v.round2(principal);
  assert.equal(v.round2(interest + principal), v.round2(pay * 12));
  assert.ok(balance < 900000 && balance > 880000);
  const y = v.propertyYields({
    purchase_cost: 1500000, loan_principal: 900000, income_12m: 54000, expenses_12m: 6000,
    interest_12m: interest, principal_12m: principal,
  });
  assert.equal(y.equity, 600000);
  assert.equal(y.gross, 0.036);                                    // 54,000 / 1,500,000
  assert.equal(y.noi, v.round2(54000 - 6000 - interest));
  assert.equal(y.net, Math.round(((54000 - 6000 - interest) / 600000) * 100000) / 100000);
  assert.equal(y.cash_flow, v.round2(54000 - 6000 - interest - principal));
  assert.ok(y.cash_on_cash < y.net);                               // principal is cash out, not cost
});

test('yields are null, never 0, when inputs are missing', () => {
  const y = v.propertyYields({ purchase_cost: 1000000, income_12m: null });
  assert.equal(y.gross, null); assert.equal(y.net, null); assert.equal(y.cash_on_cash, null);
  const z = v.propertyYields({ purchase_cost: null, income_12m: 30000 });
  assert.equal(z.gross, null); assert.equal(z.net, null);
  // fully financed: no equity → net yields null
  const w = v.propertyYields({ purchase_cost: 500000, loan_principal: 500000, income_12m: 30000 });
  assert.equal(w.gross, 0.06); assert.equal(w.net, null); assert.equal(w.equity, null);
});

test('investment return: gain, percent, annualized only after a year', () => {
  assert.deepEqual(v.investmentReturn(100000, 112000, '2025-01-01', '2025-06-01'), { gain: 12000, pct: 0.12, annualized: null });
  const r = v.investmentReturn(100000, 121000, '2024-01-01', '2026-01-01');
  assert.equal(r.gain, 21000);
  assert.ok(Math.abs(r.annualized - 0.1) < 0.001);
  assert.deepEqual(v.investmentReturn(100000, null, null, null), { gain: null, pct: null, annualized: null });
});

test('parsing rates and shares; deadline states', () => {
  assert.equal(v.parseRatePct('4.5'), 0.045);
  assert.equal(v.parseRatePct('4.5%'), 0.045);
  assert.equal(v.parseRatePct('0'), 0);
  assert.equal(v.parseRatePct('150'), null);
  assert.equal(v.parseRatePct('abc'), null);
  assert.equal(v.parsePct('60'), 60);
  assert.equal(v.parsePct('101'), null);
  assert.equal(v.deadlineState('2026-10-01', null, '2026-10-07'), 'overdue');
  assert.equal(v.deadlineState('2026-10-10', null, '2026-10-07'), 'soon');
  assert.equal(v.deadlineState('2026-11-10', null, '2026-10-07'), 'later');
  assert.equal(v.deadlineState('2026-10-01', '2026-10-02T10:00:00Z', '2026-10-07'), 'done');
});
