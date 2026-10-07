'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const s      = require('../lib/snapshots');

test('isoWeek: year boundaries', () => {
  assert.equal(s.isoWeek('2026-10-07'), '2026-W41');
  assert.equal(s.isoWeek('2025-12-29'), '2026-W01');
  assert.equal(s.isoWeek('2027-01-01'), '2026-W53');
});

const entities = [
  { type: 'retainer', branch: 'adigital', status: 'active', data: { amount_net: 2500 } },
  { type: 'retainer', branch: 'adigital', status: 'active', data: { amount_net: 1500 } },
  { type: 'debt',     branch: 'adigital', status: 'open',   data: { amount_gross: 5900 } },
];

test('snapshot rows: values, bases, period', () => {
  const rows = s.buildSnapshotRows({ todayIso: '2026-10-07', entities, tasks: [{ done: false, due: '2026-10-01' }] });
  const by = Object.fromEntries(rows.map(r => [r.kpi_key, r]));
  assert.equal(by.mrr.value, 4000);
  assert.equal(by.mrr.vat_basis, 'ex_vat');
  assert.equal(by.open_debts.value, 5900);
  assert.equal(by.open_debts.vat_basis, 'incl_vat');
  assert.equal(by.overdue_tasks.value, 1);
  assert.ok(rows.every(r => r.period === '2026-W41'));
});

test('snapshot rows: KPI without data is left out, not saved as 0', () => {
  const rows = s.buildSnapshotRows({ todayIso: '2026-10-07', entities: [], tasks: [] });
  assert.deepEqual(rows, []);
});

// Emulates the table's UNIQUE (period, kpi_key, domain, branch, basis) + ON CONFLICT
function fakeClient() {
  const table = new Map();
  return {
    table,
    async query(sql, [period, kpiKey, domain, branch, value, basis, vatBasis]) {
      assert.match(sql, /ON CONFLICT \(period, kpi_key, domain, branch, basis\)\s+DO UPDATE/);
      table.set([period, kpiKey, domain, branch, basis].join('|'), { value, vatBasis });
    },
  };
}

test('two syncs in the same week → one snapshot per KPI (upsert)', async () => {
  const c = fakeClient();
  await s.writeSnapshots(c, s.buildSnapshotRows({ todayIso: '2026-10-05', entities, tasks: [] }));
  const changed = [...entities, { type: 'retainer', branch: 'adigital', status: 'active', data: { amount_net: 1000 } }];
  await s.writeSnapshots(c, s.buildSnapshotRows({ todayIso: '2026-10-09', entities: changed, tasks: [] }));
  assert.equal(c.table.size, 3); // mrr, open_debts, concentration_max_pct
  assert.equal(c.table.get('2026-W41|mrr|business|adigital|group_100').value, 5000);
});
