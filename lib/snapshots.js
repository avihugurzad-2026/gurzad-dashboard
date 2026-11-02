// Weekly KPI snapshots (DASHBOARD-SPEC-v2 §3). One row per
// (period, kpi_key, domain, branch, basis); a second sync in the same week updates it.
'use strict';

const kpi = require('./kpi');

const ALL = '_all'; // domain/branch for group-wide KPIs (NULL would break the unique key)

// ISO-8601 week, e.g. '2026-W41'
function isoWeek(dateIso) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);           // Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// entities: [{ type, branch, status, data }], tasks: [{ done, due }]
// KPIs with no data are left out — a missing week is "no data", not 0.
function buildSnapshotRows({ todayIso, entities, tasks }) {
  const period = isoWeek(todayIso);
  const of = (type, branch) => entities
    .filter(e => e.type === type && e.branch === branch)
    .map(e => ({ ...e.data, status: e.status }));

  const rows = [
    { kpi_key: 'mrr',        domain: 'business', branch: 'adigital', basis: 'group_100', vat_basis: 'ex_vat',
      value: kpi.mrr(of('retainer', 'adigital')) },
    { kpi_key: 'open_debts', domain: 'business', branch: 'adigital', basis: 'group_100', vat_basis: 'incl_vat',
      value: kpi.openDebtsGross(of('debt', 'adigital')) },
  ];
  // Scorecard inputs (v2 §5.2); each only when its source data exists
  const adigitalRetainers = of('retainer', 'adigital');
  const conc = kpi.concentration(adigitalRetainers);
  rows.push({ kpi_key: 'concentration_max_pct', domain: 'business', branch: 'adigital', basis: 'n/a', vat_basis: 'n/a',
    value: conc ? conc.max_pct : null });

  const invoices = entities.filter(e => e.type === 'invoice');
  if (invoices.length) {
    rows.push({ kpi_key: 'allocation_missing_count', domain: ALL, branch: ALL, basis: 'n/a', vat_basis: 'n/a',
      value: invoices.filter(e => e.data?.allocation_required === true && !e.data?.allocation_number).length });
  }

  const receivables = entities.filter(e => (e.type === 'debt' || e.type === 'invoice') && e.data?.due_date)
    .map(e => ({ ...e.data, status: e.status }));
  if (receivables.length) {
    const ag = kpi.aging(receivables, todayIso);
    rows.push({ kpi_key: 'overdue_debt_30', domain: ALL, branch: ALL, basis: 'group_100', vat_basis: 'incl_vat',
      value: ag ? Math.round(ag.buckets.d31_60 + ag.buckets.d61_90 + ag.buckets.d90_plus) : null });
  }

  const cash = entities.filter(e => e.type === 'cash-account' && e.data?.cash_class === 'operating');
  if (cash.length) {
    rows.push({ kpi_key: 'cash_operating', domain: ALL, branch: ALL, basis: 'group_100', vat_basis: 'incl_vat',
      value: kpi.sumOrNull(cash.map(e => e.data.balance)) });
  }

  if (tasks.length) {
    rows.push({ kpi_key: 'overdue_tasks', domain: ALL, branch: ALL, basis: 'n/a', vat_basis: 'n/a',
      value: tasks.filter(t => !t.done && t.due && t.due < todayIso).length });
  }
  return rows.filter(r => r.value !== null).map(r => ({ period, ...r }));
}

const UPSERT_SQL = `
  INSERT INTO kpi_snapshots (taken_at, period, kpi_key, domain, branch, value, basis, vat_basis)
  VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (period, kpi_key, domain, branch, basis)
  DO UPDATE SET value = EXCLUDED.value, vat_basis = EXCLUDED.vat_basis, taken_at = EXCLUDED.taken_at`;

async function writeSnapshots(client, rows) {
  for (const r of rows) {
    await client.query(UPSERT_SQL, [r.period, r.kpi_key, r.domain, r.branch, r.value, r.basis, r.vat_basis]);
  }
  return rows.length;
}

module.exports = { ALL, isoWeek, buildSnapshotRows, writeSnapshots, UPSERT_SQL };
