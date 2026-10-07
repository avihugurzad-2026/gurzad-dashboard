// Persistent alerts (BUILD-SPEC §8, DASHBOARD-SPEC-v2 §6).
// evaluateRules() turns current data into candidate alerts; reconcileAlerts() diffs them
// against the open rows in `alerts` so one breach stays one row: new → insert,
// still there → touch last_seen, gone → resolved_at. Both are pure; applyAlerts() does the SQL.
'use strict';

const kpi = require('./kpi');
const { paramAt } = require('./params');

const SEVERITY_ORDER = { red: 0, orange: 1 };

// Rules that can run on today's data. Cash/forecast rules (v2 §6) join in stage 1.5.
// params: { overdue_red_days, owner, actions: { <rule_id>: text } }
function evaluateRules({ todayIso, entities, tasks, params }) {
  const out = [];
  const owner = params.owner ?? null;
  const add = (a) => out.push({
    level: a.severity === 'red' ? 'critical' : 'warning',
    owner, suggested_action: params.actions?.[a.rule_id] ?? null,
    amount: null, days: null, counterparty: null, entity_id: null, domain: null, branch: null,
    ...a,
  });
  const redDays = params.overdue_red_days ?? null;

  for (const e of entities) {
    const d = e.data || {};
    const open = kpi.isOpen(e.status);

    // Tax invoice above the allocation threshold without an allocation number
    if (e.type === 'invoice' && d.allocation_required === true && !d.allocation_number) {
      add({ rule_id: 'allocation_missing', alert_key: `allocation_missing:${e.id}`, severity: 'red',
        entity_id: e.id, domain: e.domain, branch: e.branch, counterparty: d.client ?? null,
        amount: kpi.toNum(d.amount_net), title: 'חשבונית מעל הסף בלי מספר הקצאה' });
    }

    // Overdue receivable (needs due_date; balances without one can't be aged)
    if (open && (e.type === 'invoice' || e.type === 'debt') && d.due_date && d.due_date < todayIso) {
      const days = kpi.daysBetween(d.due_date, todayIso);
      const amount = kpi.outstandingGross(d);
      if (amount !== null && amount > 0) {
        add({ rule_id: 'overdue_debt', alert_key: `overdue_debt:${e.id}`,
          severity: redDays !== null && days > redDays ? 'red' : 'orange',
          entity_id: e.id, domain: e.domain, branch: e.branch, counterparty: d.client ?? null,
          amount, days, title: 'חוב באיחור' });
      }
    }

    // Promise to pay that has passed
    if (open && d.promise_to_pay_date && d.promise_to_pay_date < todayIso) {
      add({ rule_id: 'promise_broken', alert_key: `promise_broken:${e.id}`, severity: 'orange',
        entity_id: e.id, domain: e.domain, branch: e.branch, counterparty: d.client ?? null,
        amount: kpi.outstandingGross(d), days: kpi.daysBetween(d.promise_to_pay_date, todayIso),
        title: 'הבטחת תשלום שלא קוימה' });
    }

    // Retainer notice deadline within 60 days (BUILD-SPEC: notice_deadline = contract_end − notice_period_days)
    if (e.type === 'retainer' && e.status === 'active') {
      const deadline = noticeDeadline(d);
      if (deadline && deadline >= todayIso) {
        const days = kpi.daysBetween(todayIso, deadline);
        if (days <= 60) {
          add({ rule_id: 'notice_deadline', alert_key: `notice_deadline:${e.id}:${deadline}`, severity: 'orange',
            entity_id: e.id, domain: e.domain, branch: e.branch, counterparty: d.client ?? null,
            days, title: `מועד הודעה על חידוש בעוד ${days} ימים` });
        }
      }
    }
  }

  // Overdue tasks
  for (const t of tasks) {
    if (t.done || !t.due || t.due >= todayIso) continue;
    const days = kpi.daysBetween(t.due, todayIso);
    add({ rule_id: 'task_overdue', alert_key: `task_overdue:${t.id}`,
      severity: redDays !== null && days > redDays ? 'red' : 'orange',
      entity_id: t.id, domain: t.domain, branch: t.branch, days, title: t.text });
  }

  return out;
}

function noticeDeadline(d) {
  if (d.notice_deadline) return String(d.notice_deadline);
  if (!d.contract_end || d.notice_period_days == null) return null;
  const t = new Date(`${d.contract_end}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - Number(d.notice_period_days));
  return t.toISOString().split('T')[0];
}

const MUTABLE = ['severity', 'level', 'title', 'amount', 'days', 'counterparty', 'suggested_action', 'owner', 'domain', 'branch'];

// open: rows from `alerts` WHERE resolved_at IS NULL. Returns what to do, no SQL.
function reconcileAlerts(open, candidates) {
  const openByKey = new Map(open.map(a => [a.alert_key, a]));
  const seen = new Set();
  const insert = [], touch = [];
  for (const c of candidates) {
    if (seen.has(c.alert_key)) continue; // same breach twice in one run → one alert
    seen.add(c.alert_key);
    const existing = openByKey.get(c.alert_key);
    if (existing) touch.push({ id: existing.id, ...pick(c, MUTABLE) });
    else insert.push(c);
  }
  const resolve = open.filter(a => !seen.has(a.alert_key)).map(a => a.id);
  return { insert, touch, resolve };
}

const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k] ?? null]));

async function applyAlerts(client, candidates) {
  const { rows: open } = await client.query(`SELECT id, alert_key FROM alerts WHERE resolved_at IS NULL`);
  const { insert, touch, resolve } = reconcileAlerts(open, candidates);
  for (const a of insert) {
    await client.query(
      `INSERT INTO alerts (alert_key, rule_id, severity, level, entity_id, domain, branch, title, amount, days,
                           counterparty, suggested_action, owner, first_seen, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())`,
      [a.alert_key, a.rule_id, a.severity, a.level, a.entity_id, a.domain, a.branch, a.title, a.amount, a.days,
       a.counterparty, a.suggested_action, a.owner]);
  }
  for (const t of touch) {
    // snoozed_until and first_seen are kept: snooze is the owner's choice, age counts from the first sighting
    await client.query(
      `UPDATE alerts SET last_seen = NOW(), severity=$2, level=$3, title=$4, amount=$5, days=$6,
              counterparty=$7, suggested_action=$8, owner=$9, domain=$10, branch=$11
       WHERE id = $1`,
      [t.id, t.severity, t.level, t.title, t.amount, t.days, t.counterparty, t.suggested_action, t.owner, t.domain, t.branch]);
  }
  if (resolve.length) {
    await client.query(`UPDATE alerts SET resolved_at = NOW() WHERE id = ANY($1::bigint[])`, [resolve]);
  }
  return { inserted: insert.length, touched: touch.length, resolved: resolve.length };
}

// Home panel: open, not snoozed past today, red first, then oldest; max 7 (+ "ועוד N")
function panelItems(open, todayIso, max = 7) {
  const visible = open
    .filter(a => !a.snoozed_until || String(a.snoozed_until).slice(0, 10) <= todayIso)
    .sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
      || (new Date(a.first_seen) - new Date(b.first_seen)));
  return {
    items: visible.slice(0, max).map(a => ({ ...a, open_days: kpi.daysBetween(String(isoDate(a.first_seen)), todayIso) })),
    more: Math.max(0, visible.length - max),
    snoozed: open.length - visible.length,
  };
}

const isoDate = v => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

// Snooze must be a real future date
function validSnooze(until, todayIso) {
  return typeof until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(until)
    && !Number.isNaN(Date.parse(until)) && until > todayIso;
}

// Alert settings from `parameters` rows (seeded by migration 20261007134349, vault overrides)
function alertParams(rows, todayIso) {
  const v = key => paramAt(rows, key, todayIso)?.value ?? null;
  return {
    overdue_red_days: v('overdue_red_days'),
    owner: v('alert_owner_default'),
    actions: {
      allocation_missing: v('action_allocation_missing'),
      overdue_debt:       v('action_overdue_debt'),
      promise_broken:     v('action_overdue_debt'),
      task_overdue:       v('action_task_overdue'),
    },
  };
}

module.exports = { alertParams, evaluateRules, reconcileAlerts, applyAlerts, panelItems, validSnooze, noticeDeadline };
