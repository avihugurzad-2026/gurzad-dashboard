'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/ledger');

test('recurring: next due date clamps to month length and respects the end date', () => {
  const r = { frequency: 'monthly', day_of_month: 31, start_date: '2026-01-31' };
  assert.equal(L.nextDue(r, '2026-04-02'), '2026-04-30');
  assert.equal(L.advanceDue(r, '2026-04-30'), '2026-05-31');
  assert.equal(L.nextDue({ frequency: 'yearly', day_of_month: 15, start_date: '2025-03-15' }, '2026-04-01'), '2027-03-15');
  assert.equal(L.nextDue({ frequency: 'monthly', day_of_month: 1, start_date: '2026-01-01', end_date: '2026-03-31' }, '2026-04-01'), null);
  assert.equal(L.nextDue({ frequency: 'custom', interval_months: 2, day_of_month: 10, start_date: '2026-01-10' }, '2026-02-01'), '2026-03-10');
  assert.equal(L.nextDue({ frequency: 'one_time', start_date: '2026-11-05' }, '2026-10-08'), '2026-11-05');
});

test('recurring: monthly equivalent', () => {
  assert.equal(L.monthlyEquivalent({ frequency: 'yearly', amount: 1200 }), 100);
  assert.equal(L.monthlyEquivalent({ frequency: 'custom', interval_months: 3, amount: 300 }), 100);
  assert.equal(L.monthlyEquivalent({ frequency: 'one_time', amount: 500 }), 0);
});

test('budget: budget, actual, remaining, variance; unbudgeted spending is reported', () => {
  const v = L.budgetView([{ category_id: 'a', name: 'מזון', budget: 3000 }, { category_id: 'b', name: 'דיור', budget: 6000 }], { a: 3250.5, c: 100 });
  assert.deepEqual(v.rows[0], { category_id: 'a', name: 'מזון', budget: 3000, actual: 3250.5, remaining: -250.5, variance: 250.5, pct: 108, over: true });
  assert.equal(v.rows[1].actual, 0);
  assert.deepEqual(v.unbudgeted, [{ category_id: 'c', actual: 100 }]);
  assert.deepEqual(v.totals, { budget: 9000, actual: 3350.5, remaining: 5649.5, variance: -5649.5 });
});

test('savings: progress, months left and whether the plan meets the deadline', () => {
  const v = L.savingsView({ target_amount: 10000, current_amount: 4000, monthly_contribution: 1000, deadline: '2027-01-01' }, '2026-10-08');
  assert.equal(v.pct, 40); assert.equal(v.left, 6000); assert.equal(v.monthsLeft, 6); assert.equal(v.needPerMonth, 2000); assert.equal(v.onTrack, false);
  assert.equal(L.savingsView({ target_amount: 100, current_amount: 150 }, '2026-10-08').reached, true);
});

test('contributions: the household sees amounts only; a percentage plan is private until paid', () => {
  const plans = [
    { id: 'p1', user_id: 'a', name: 'A', rule: 'fixed', amount: 15000, status: 'active', start_date: '2026-01-01', frequency: 'monthly' },
    { id: 'p2', user_id: 'b', name: 'B', rule: 'fixed', amount: 6000, status: 'active', start_date: '2026-01-01', frequency: 'monthly' },
    { id: 'p3', user_id: 'c', name: 'C', rule: 'percentage', percentage: 25, status: 'active', start_date: '2026-01-01', frequency: 'monthly' },
  ];
  const pay = [{ contribution_id: 'p1', user_id: 'a', amount: 15000, status: 'received' }, { contribution_id: 'p2', user_id: 'b', amount: 3000, status: 'received' }];
  const m = L.contributionMonth(plans, pay, '2026-10-01');
  assert.equal(m.expected, 21000); assert.equal(m.received, 18000); assert.equal(m.pending, 3000);
  assert.equal(m.rows[2].expected, null);
  assert.ok(!JSON.stringify(m).includes('25'));   // the percentage never reaches the household view
  assert.equal(L.contributionDue(plans[2], 60000), 15000);
  assert.equal(L.contributionDue(plans[2], null), null);
  assert.equal(L.contributionActive({ ...plans[0], start_date: '2026-11-01' }, '2026-10-01'), false);
  assert.equal(L.nextContribution({ rule: 'fixed', status: 'active', day_of_month: 1, start_date: '2026-01-01' }, '2026-10-08'), '2026-11-01');
});

test('merchants and rules: normalize, match, duplicates', () => {
  assert.equal(L.normalizeMerchant('NETFLIX.COM 866-579'), 'netflix.com');
  assert.equal(L.normalizeMerchant('שופרסל דיל 4421'), 'שופרסל דיל');
  const rules = [{ id: 'r1', pattern: 'netflix', match_type: 'contains', priority: 100 }, { id: 'r2', pattern: 'NETFLIX.COM', match_type: 'equals', priority: 50 }];
  assert.equal(L.matchRule(rules, { merchant: 'NETFLIX.COM 1234' }).id, 'r2');
  assert.equal(L.matchRule(rules, { merchant: 'Netflix Intl' }).id, 'r1');
  assert.equal(L.matchRule(rules, { merchant: 'Spotify' }), null);
  const existing = [{ id: 't', amount: 54.9, occurred_on: '2026-10-02', merchant: 'NETFLIX.COM' }];
  assert.equal(L.isDuplicate({ amount: '54.90', occurred_on: '2026-10-04', merchant: 'Netflix.com 99' }, existing).id, 't');
  assert.equal(L.isDuplicate({ amount: 54.9, occurred_on: '2026-10-09', merchant: 'NETFLIX.COM' }, existing), null);
  assert.equal(L.defaultWorkspace({ workspace_id: 'hh' }, 'me'), 'hh');
  assert.equal(L.defaultWorkspace(null, 'me'), 'me');
});
