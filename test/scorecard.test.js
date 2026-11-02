'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const sc     = require('../lib/scorecard');

const today = '2026-10-07';

test('13 ISO weeks ending this week', () => {
  const w = sc.lastWeeks(today);
  assert.equal(w.length, 13);
  assert.equal(w[12], '2026-W41');
  assert.equal(w[0], '2026-W29');
});

test('goal locked for 13 weeks: change before locked_until is rejected', () => {
  const m = { key: 'mrr', weekly_goal: 20000, locked_until: '2026-12-31' };
  assert.equal(sc.goalChange(m, today).ok, false);
  assert.match(sc.goalChange(m, today).reason, /נעול עד 2026-12-31/);
});

test('quarterly planning may change a locked goal and re-locks for 13 weeks', () => {
  const r = sc.goalChange({ weekly_goal: 1, locked_until: '2026-12-31' }, today, { quarterlyPlanning: true });
  assert.deepEqual(r, { ok: true, effective_from: today, locked_until: '2027-01-06' });
  assert.equal(sc.goalChange({ weekly_goal: 1, locked_until: '2026-10-07' }, today).ok, true); // lock ends today
  assert.equal(sc.goalChange({ locked_until: null }, today).ok, true);
});

test('measure row: missing weeks are null, status by direction, issue after 2 off weeks', () => {
  const weeks = sc.lastWeeks(today, 3); // W39, W40, W41
  const snaps = [
    { kpi_key: 'overdue_tasks', domain: '_all', branch: '_all', basis: 'n/a', period: '2026-W40', value: '2' },
    { kpi_key: 'overdue_tasks', domain: '_all', branch: '_all', basis: 'n/a', period: '2026-W41', value: '1' },
  ];
  const r = sc.measureRow({ key: 'overdue_tasks', domain: '_all', branch: '_all', weekly_goal: 0, direction: 'lower_better' }, snaps, weeks);
  assert.deepEqual(r.cells.map(c => [c.value, c.status]), [[null, null], [2, 'off'], [1, 'off']]);
  assert.equal(r.suggest_issue, true);
  assert.equal(r.latest.value, 1);
});

test('no goal yet → no status (not "off")', () => {
  assert.equal(sc.status(20000, null, 'higher_better'), null);
  assert.equal(sc.status(20000, 15000, 'higher_better'), 'on');
});

test('setting the first goal of a measure (goal still empty) is allowed even while locked', () => {
  assert.equal(sc.goalChange({ weekly_goal: null, locked_until: '2026-12-31' }, today).ok, true);
});
