'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const a      = require('../lib/alerts');

const today  = '2026-10-07';
const params = { overdue_red_days: 30, owner: 'אביהו', actions: { overdue_debt: 'שלח תזכורת + שיחה ללקוח' } };

test('rules: allocation missing on invoices only', () => {
  const out = a.evaluateRules({ todayIso: today, params, tasks: [], entities: [
    { id: 'i1', type: 'invoice', status: 'open', data: { allocation_required: true, amount_net: 9000, client: 'א' } },
    { id: 'i2', type: 'invoice', status: 'open', data: { allocation_required: true, allocation_number: '123' } },
    { id: 'r1', type: 'retainer', status: 'active', data: { allocation_required: true } },
  ] });
  assert.deepEqual(out.map(x => x.alert_key), ['allocation_missing:i1']);
  assert.equal(out[0].severity, 'red');
  assert.equal(out[0].owner, 'אביהו');
});

test('rules: overdue debt orange ≤30 days, red >30; no due_date → no alert', () => {
  const out = a.evaluateRules({ todayIso: today, params, tasks: [], entities: [
    { id: 'd1', type: 'debt', status: 'open', data: { due_date: '2026-09-07', amount_gross: 1180 } },  // 30 days
    { id: 'd2', type: 'debt', status: 'open', data: { due_date: '2026-09-06', amount_gross: 590 } },   // 31 days
    { id: 'd3', type: 'debt', status: 'open', data: { amount_gross: 76504 } },
    { id: 'd4', type: 'debt', status: 'paid', data: { due_date: '2026-01-01', amount_gross: 5 } },
  ] });
  assert.deepEqual(out.map(x => [x.alert_key, x.severity, x.days]),
    [['overdue_debt:d1', 'orange', 30], ['overdue_debt:d2', 'red', 31]]);
  assert.equal(out[0].suggested_action, 'שלח תזכורת + שיחה ללקוח');
});

test('rules: notice deadline within 60 days from contract_end − notice_period_days', () => {
  const out = a.evaluateRules({ todayIso: today, params, tasks: [], entities: [
    { id: 'r1', type: 'retainer', status: 'active', data: { contract_end: '2026-12-31', notice_period_days: 30 } }, // 2026-12-01 → 55 days
    { id: 'r2', type: 'retainer', status: 'active', data: { contract_end: '2027-06-30', notice_period_days: 30 } },
  ] });
  assert.deepEqual(out.map(x => [x.alert_key, x.days]), [['notice_deadline:r1:2026-12-01', 55]]);
});

test('rules: overdue tasks; no threshold param → orange (no hardcoded 30)', () => {
  const tasks = [{ id: 't1', text: 'x', done: false, due: '2026-08-01' }, { id: 't2', text: 'y', done: true, due: '2026-08-01' }];
  assert.equal(a.evaluateRules({ todayIso: today, params, entities: [], tasks })[0].severity, 'red');
  assert.equal(a.evaluateRules({ todayIso: today, params: {}, entities: [], tasks })[0].severity, 'orange');
});

test('reconcile: new → insert; same breach again → touch, not a duplicate', () => {
  const c = { alert_key: 'k1', severity: 'red', title: 't' };
  const first = a.reconcileAlerts([], [c, { ...c }]);
  assert.equal(first.insert.length, 1);
  const second = a.reconcileAlerts([{ id: 7, alert_key: 'k1' }], [{ ...c, days: 5 }]);
  assert.deepEqual([second.insert.length, second.touch.length, second.resolve.length], [0, 1, 0]);
  assert.equal(second.touch[0].id, 7);
  assert.equal(second.touch[0].days, 5);
});

test('reconcile: breach gone → resolved; touch does not carry snoozed_until or first_seen', () => {
  const r = a.reconcileAlerts([{ id: 1, alert_key: 'gone' }, { id: 2, alert_key: 'k' }],
    [{ alert_key: 'k', severity: 'orange', title: 't', snoozed_until: '2099-01-01', first_seen: 'x' }]);
  assert.deepEqual(r.resolve, [1]);
  assert.ok(!('snoozed_until' in r.touch[0]) && !('first_seen' in r.touch[0]));
});

test('panel: red first then oldest, snoozed hidden until the date, max 7 + more, open days', () => {
  const open = [
    { id: 1, severity: 'orange', first_seen: '2026-09-01T10:00:00Z' },
    { id: 2, severity: 'red',    first_seen: '2026-10-05T10:00:00Z' },
    { id: 3, severity: 'red',    first_seen: '2026-10-01T10:00:00Z' },
    { id: 4, severity: 'red',    first_seen: '2026-10-01T10:00:00Z', snoozed_until: '2026-10-10' },
    { id: 5, severity: 'orange', first_seen: '2026-10-01T10:00:00Z', snoozed_until: '2026-10-07' }, // expires today
  ];
  const p = a.panelItems(open, today, 3);
  assert.deepEqual(p.items.map(x => x.id), [3, 2, 1]);
  assert.equal(p.items[0].open_days, 6);
  assert.equal(p.more, 1);
  assert.equal(p.snoozed, 1);
});

test('snooze date must be a valid future date', () => {
  assert.equal(a.validSnooze('2026-10-08', today), true);
  assert.equal(a.validSnooze('2026-10-07', today), false);
  assert.equal(a.validSnooze('7/10/2026', today), false);
  assert.equal(a.validSnooze(undefined, today), false);
});

test('alertParams reads owner, red-days and actions from parameter rows', () => {
  const p = a.alertParams([
    { key: 'overdue_red_days', effective_from: '2000-01-01', value: { value: 30 } },
    { key: 'alert_owner_default', effective_from: '2000-01-01', value: { value: 'אביהו' } },
    { key: 'action_task_overdue', effective_from: '2000-01-01', value: { value: 'טפל' } },
  ], today);
  assert.deepEqual([p.overdue_red_days, p.owner, p.actions.task_overdue, p.actions.overdue_debt], [30, 'אביהו', 'טפל', null]);
});
