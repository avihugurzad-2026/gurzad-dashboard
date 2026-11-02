// EOS-style Scorecard (DASHBOARD-SPEC-v2 §5.2): 5-15 weekly measures with owner, goal,
// direction and 13 weeks of history from kpi_snapshots. Goals are locked for 13 weeks;
// they change only through an explicit quarterly-planning action.
'use strict';

const { isoWeek } = require('./snapshots');
const { addDaysIso } = require('./forecast');

const LOCK_DAYS = 13 * 7;

// The last n ISO weeks ending with the week of todayIso, oldest first
function lastWeeks(todayIso, n = 13) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(isoWeek(addDaysIso(todayIso, -7 * i)));
  return [...new Set(out)];
}

function status(value, goal, direction) {
  if (value === null || value === undefined || goal === null || goal === undefined) return null;
  const v = Number(value), g = Number(goal);
  return (direction === 'lower_better' ? v <= g : v >= g) ? 'on' : 'off';
}

// measure: row of scorecard_measures; snapshots: rows of kpi_snapshots
function measureRow(measure, snapshots, weeks) {
  const kpiKey = measure.source_kpi || measure.key;
  const byPeriod = new Map(snapshots
    .filter(s => s.kpi_key === kpiKey && s.domain === measure.domain && s.branch === measure.branch
      && (s.basis === 'group_100' || s.basis === 'n/a'))
    .map(s => [s.period, Number(s.value)]));
  const cells = weeks.map(period => {
    const value = byPeriod.has(period) ? byPeriod.get(period) : null; // missing week = no data, not 0
    return { period, value, status: status(value, measure.weekly_goal, measure.direction) };
  });
  const tail = cells.filter(c => c.status !== null).slice(-2);
  return {
    ...measure,
    cells,
    latest: [...cells].reverse().find(c => c.value !== null) ?? null,
    suggest_issue: tail.length === 2 && tail.every(c => c.status === 'off'), // off two weeks running
  };
}

// Goal changes: allowed when the lock expired, or explicitly as quarterly planning
function goalChange(measure, todayIso, { quarterlyPlanning = false } = {}) {
  // First goal for a measure (none set yet) is not a change, so the lock doesn't apply
  if (measure.weekly_goal === null || measure.weekly_goal === undefined) {
    return { ok: true, effective_from: todayIso, locked_until: addDaysIso(todayIso, LOCK_DAYS) };
  }
  const locked = measure.locked_until && String(measure.locked_until).slice(0, 10) > todayIso;
  if (locked && !quarterlyPlanning) {
    return { ok: false, reason: `היעד נעול עד ${String(measure.locked_until).slice(0, 10)}. שינוי רק בתכנון רבעוני.` };
  }
  return { ok: true, effective_from: todayIso, locked_until: addDaysIso(todayIso, LOCK_DAYS) };
}

function validGoal(v) {
  return v === null || (typeof v === 'number' && Number.isFinite(v));
}

module.exports = { LOCK_DAYS, lastWeeks, status, measureRow, goalChange, validGoal };
