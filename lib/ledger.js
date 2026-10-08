// The personal / household finance engine as pure functions: budgets, recurring dates, savings
// progress, contributions and categorization rules. No amounts, people or categories live here;
// everything is computed from rows the user entered.
'use strict';

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// ── Dates ─────────────────────────────────────────────────────────────────────
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const monthStart = iso => `${iso.slice(0, 7)}-01`;
function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}
// The day `day` of the month of `iso`, clamped to the month's length (31 → 30 in April)
function dayInMonth(iso, day) {
  const [y, m] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

const STEP = { monthly: 1, bimonthly: 2, quarterly: 3, yearly: 12 };

// How many months between occurrences (null = once)
function stepMonths(frequency, intervalMonths) {
  if (frequency === 'custom') return intervalMonths && intervalMonths > 0 ? intervalMonths : null;
  return STEP[frequency] ?? null;
}

// The first due date on or after `fromIso` for a recurring expense
function nextDue(r, fromIso) {
  const step = stepMonths(r.frequency, r.interval_months);
  const start = r.start_date && ISO.test(r.start_date) ? r.start_date : fromIso;
  const day = r.day_of_month || Number(start.slice(8, 10));
  if (step === null) {
    const once = r.next_due || start;
    return once >= fromIso ? once : null;
  }
  let d = dayInMonth(start, day);
  if (d < start) d = dayInMonth(addMonths(start, step), day);
  let guard = 0;
  while (d < fromIso && guard++ < 1000) d = dayInMonth(addMonths(d, step), day);
  if (r.end_date && d > r.end_date) return null;
  return d;
}

// After recording one occurrence, when is the next one?
function advanceDue(r, dueIso) {
  const step = stepMonths(r.frequency, r.interval_months);
  if (step === null) return null;
  const next = dayInMonth(addMonths(dueIso, step), r.day_of_month || Number(dueIso.slice(8, 10)));
  return r.end_date && next > r.end_date ? null : next;
}

// A recurring amount as a monthly figure (yearly 1,200 → 100 a month); one-time → 0
function monthlyEquivalent(r) {
  const step = stepMonths(r.frequency, r.interval_months);
  return step ? round2(Number(r.amount) / step) : 0;
}

// ── Budgets ───────────────────────────────────────────────────────────────────
// lines: [{ category_id, name, budget }]; actuals: { [category_id]: spent }. Spending in categories
// without a budget line is reported separately (never hidden).
function budgetView(lines, actuals) {
  const seen = new Set();
  const rows = lines.map(l => {
    seen.add(l.category_id);
    const actual = round2(Number(actuals[l.category_id] ?? 0));
    const budget = round2(Number(l.budget));
    const remaining = round2(budget - actual);
    return {
      category_id: l.category_id, name: l.name, budget, actual, remaining,
      variance: round2(actual - budget),                       // > 0 = over budget
      pct: budget > 0 ? Math.round((actual / budget) * 100) : null,
      over: actual > budget,
    };
  });
  const unbudgeted = Object.entries(actuals)
    .filter(([id, v]) => !seen.has(id) && Number(v) > 0)
    .map(([category_id, v]) => ({ category_id, actual: round2(Number(v)) }));
  const sum = k => round2(rows.reduce((a, r) => a + r[k], 0));
  const totalActual = round2(sum('actual') + unbudgeted.reduce((a, r) => a + r.actual, 0));
  return {
    rows, unbudgeted,
    totals: { budget: sum('budget'), actual: totalActual, remaining: round2(sum('budget') - totalActual), variance: round2(totalActual - sum('budget')) },
  };
}

// ── Savings goals ─────────────────────────────────────────────────────────────
// Progress, and how many months are left at the planned monthly amount (null when unknown)
function savingsView(g, todayIso) {
  const target = Number(g.target_amount), current = Number(g.current_amount ?? 0);
  const left = round2(Math.max(0, target - current));
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : null;
  const monthly = g.monthly_contribution ? Number(g.monthly_contribution) : null;
  const monthsLeft = left === 0 ? 0 : monthly ? Math.ceil(left / monthly) : null;
  let needPerMonth = null;
  if (g.deadline && left > 0 && g.deadline > todayIso) {
    const months = Math.max(1, (Number(g.deadline.slice(0, 4)) - Number(todayIso.slice(0, 4))) * 12
      + Number(g.deadline.slice(5, 7)) - Number(todayIso.slice(5, 7)));
    needPerMonth = round2(left / months);
  }
  const onTrack = needPerMonth === null || monthly === null ? null : monthly >= needPerMonth;
  return { target, current, left, pct, monthsLeft, needPerMonth, onTrack, reached: left === 0 };
}

// ── Contributions ─────────────────────────────────────────────────────────────
// The amount a contribution plan asks for in a period. A percentage plan needs the contributor's
// income for that month, which only the personal side knows: the household never calls this with it.
function contributionDue(c, incomeForPeriod) {
  if (c.rule === 'fixed') return round2(Number(c.amount));
  if (c.rule === 'percentage') return incomeForPeriod ? round2((Number(incomeForPeriod) * Number(c.percentage)) / 100) : null;
  return c.amount ? round2(Number(c.amount)) : null;      // manual: the amount typed when it is paid
}

// Is a plan active in a month (period = YYYY-MM-01)?
function contributionActive(c, period) {
  if (c.status !== 'active') return false;
  if (c.start_date && monthStart(c.start_date) > period) return false;
  if (c.end_date && c.end_date < period) return false;
  if (c.frequency === 'one_time' && c.start_date && monthStart(c.start_date) !== period) return false;
  return true;
}

// The household's view of a month: expected per contributor, received and pending. Amounts only.
// plans: [{ id, user_id, name, rule, amount, status, start_date, end_date, frequency }]
// payments: [{ contribution_id, user_id, amount, status }]
function contributionMonth(plans, payments, period) {
  const rows = plans.filter(c => contributionActive(c, period)).map(c => {
    const paid = payments.filter(p => p.contribution_id === c.id && p.status === 'received');
    const received = round2(paid.reduce((a, p) => a + Number(p.amount), 0));
    // A percentage plan's expected amount is private until it is paid
    const expected = c.rule === 'fixed' ? round2(Number(c.amount)) : received > 0 ? received : null;
    const pending = expected === null ? null : round2(Math.max(0, expected - received));
    return { contribution_id: c.id, user_id: c.user_id, name: c.name, expected, received, pending, status: pending === 0 ? 'received' : received > 0 ? 'partial' : 'pending' };
  });
  const sum = k => (rows.some(r => r[k] !== null) ? round2(rows.reduce((a, r) => a + (r[k] ?? 0), 0)) : null);
  return { rows, expected: sum('expected'), received: sum('received'), pending: sum('pending') };
}

// Next transfer date of a plan from today
function nextContribution(c, todayIso) {
  if (c.status !== 'active') return null;
  if (c.frequency === 'one_time') return c.start_date && c.start_date >= todayIso ? c.start_date : null;
  const from = c.start_date && c.start_date > todayIso ? c.start_date : todayIso;
  const day = c.day_of_month || 1;
  let d = dayInMonth(from, day);
  if (d < from) d = dayInMonth(addMonths(monthStart(from), 1), day);
  if (c.end_date && d > c.end_date) return null;
  return d;
}

// ── Merchants and rules ───────────────────────────────────────────────────────
// "NETFLIX.COM 866-579" → "netflix.com"; "שופרסל דיל 123" → "שופרסל דיל"
function normalizeMerchant(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/["'`״׳*]/g, '')
    .replace(/\b(ltd|בע"?מ|inc|www\.)\b/g, '')
    .replace(/[#\d][\d\s\-/.]*$/g, '')       // trailing reference numbers
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

// The first active rule that matches (lowest priority number wins, then the longest pattern)
function matchRule(rules, tx) {
  const sorted = [...rules].filter(r => r.active !== false)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || b.pattern.length - a.pattern.length);
  for (const r of sorted) {
    const hay = normalizeMerchant(r.match_field === 'description' ? tx.description : tx.merchant || tx.description);
    const needle = normalizeMerchant(r.pattern);
    if (!needle) continue;
    if (r.match_type === 'equals' ? hay === needle : r.match_type === 'starts_with' ? hay.startsWith(needle) : hay.includes(needle)) return r;
  }
  return null;
}

// Same day ±3, same amount, similar merchant → probably the same transaction
function dedupeKey(occurredOn, amount, merchant) {
  return `${occurredOn}|${round2(Number(amount)).toFixed(2)}|${normalizeMerchant(merchant).slice(0, 40)}`;
}
function isDuplicate(candidate, existing) {
  const amt = round2(Number(candidate.amount));
  const m = normalizeMerchant(candidate.merchant || candidate.description);
  return existing.find(t => {
    if (round2(Number(t.amount)) !== amt) return false;
    const days = Math.abs((Date.parse(t.occurred_on) - Date.parse(candidate.occurred_on)) / 86400000);
    if (!(days <= 3)) return false;
    const tm = normalizeMerchant(t.merchant || t.description);
    return !m || !tm || tm.includes(m.slice(0, 8)) || m.includes(tm.slice(0, 8));
  }) ?? null;
}

// The default workspace for an imported row: the account's workspace (a household account → household)
function defaultWorkspace(account, personalWorkspaceId) {
  return account && account.workspace_id ? account.workspace_id : personalWorkspaceId;
}

module.exports = {
  round2, monthStart, addMonths, dayInMonth, stepMonths, nextDue, advanceDue, monthlyEquivalent,
  budgetView, savingsView, contributionDue, contributionActive, contributionMonth, nextContribution,
  normalizeMerchant, matchRule, dedupeKey, isDuplicate, defaultWorkspace,
};
