// 13-week rolling cash forecast (DASHBOARD-SPEC-v2 §4). Cash is incl. VAT (BUILD-SPEC §2.4).
// Only real dates are used: a receivable without due_date or a retainer without a payment
// schedule is listed in `missing`, never placed on a guessed week.
'use strict';

const kpi = require('./kpi');

const WEEKS = 13;
const DAY = 86400000;

const iso = d => d.toISOString().split('T')[0];
const addDaysIso = (dIso, n) => iso(new Date(Date.parse(`${dIso}T00:00:00Z`) + n * DAY));

function addMonthsIso(dIso, n) {
  const d = new Date(`${dIso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
}

// Monday of the week containing dIso
function weekStart(dIso) {
  const d = new Date(`${dIso}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  return addDaysIso(dIso, 1 - dow);
}

const STEP = {
  weekly: d => addDaysIso(d, 7), monthly: d => addMonthsIso(d, 1), bimonthly: d => addMonthsIso(d, 2),
  quarterly: d => addMonthsIso(d, 3), yearly: d => addMonthsIso(d, 12), once: () => null,
};
const PER_MONTH = { weekly: 52 / 12, monthly: 1, bimonthly: 0.5, quarterly: 1 / 3, yearly: 1 / 12, once: 0 };

// Cash balances by class (v2 §4.1): only operating counts for floor / weeks of spend
function cashPosition(accounts) {
  const of = cls => kpi.sumOrNull(accounts.filter(a => a.cash_class === cls).map(a => a.balance));
  const dates = accounts.map(a => a.balance_date).filter(Boolean).sort();
  return {
    operating: of('operating'), restricted: of('restricted'), reserve: of('reserve'),
    as_of: dates[0] ?? null, // oldest balance date: the position is only as fresh as this
  };
}

function grossOf(amount, vatIncluded, vatRate) {
  const a = kpi.toNum(amount);
  if (a === null) return null;
  if (vatIncluded === false) return vatRate === null ? null : Math.round(a * (1 + vatRate) * 100) / 100;
  return a;
}

// Occurrences of a recurring payment from next_due through `endIso`
function occurrences(nextDue, frequency, endIso) {
  const out = [];
  const step = STEP[frequency];
  for (let d = nextDue; d && d <= endIso && out.length < 60; d = step(d)) out.push(d);
  return out;
}

/**
 * input: { todayIso, vatRate, floorMonths,
 *          cashAccounts:[{cash_class,balance,balance_date}],
 *          receivables:[{id,client,due_date,promise_to_pay_date,amount_gross,paid_amount,status}],
 *          retainers:[{client,amount_net,status,billing_day,payment_terms_days}],
 *          commitments:[{payee,amount,vat_included,frequency,next_due}],
 *          loans:[{lender,monthly_payment,next_due}] }
 */
function buildForecast(input, scenario = 'base') {
  const { todayIso, vatRate = null, floorMonths = null } = input;
  const start = weekStart(todayIso);
  const end = addDaysIso(start, WEEKS * 7 - 1);
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({ start: addDaysIso(start, i * 7), in: 0, out: 0, closing: null }));
  const weekIdx = dIso => {
    if (dIso < start) return 0; // already due → expected now
    const i = Math.floor((Date.parse(dIso) - Date.parse(start)) / (7 * DAY));
    return i < WEEKS ? i : null;
  };
  const missing = [];
  const shift = scenario === 'late_collection' ? 30 : 0;
  const lostClient = scenario === 'lose_top_client' ? (kpi.concentration(input.retainers || [])?.top_3[0]?.name ?? null) : null;

  // Inflows: open receivables on their (promised) due date
  let undated = 0, undatedAmt = 0;
  for (const r of (input.receivables || []).filter(r => kpi.isOpen(r.status))) {
    const amt = kpi.outstandingGross(r);
    if (!amt || amt <= 0) continue;
    if (lostClient && r.client === lostClient) continue;
    const date = r.promise_to_pay_date || r.due_date;
    if (!date) { undated++; undatedAmt += amt; continue; }
    const i = weekIdx(addDaysIso(date, shift));
    if (i !== null) weeks[i].in += amt;
  }
  if (undated) missing.push({ key: 'receivable_due_date', count: undated, amount: Math.round(undatedAmt), text: `${undated} חובות בלי due_date לא נכנסו לתחזית` });

  // Inflows: active retainers that have a payment schedule
  let unscheduled = 0;
  for (const r of (input.retainers || []).filter(r => r.status === 'active')) {
    if (lostClient && r.client === lostClient) continue;
    const net = kpi.retainerFeeNet(r);
    const gross = kpi.grossFromNet(net, vatRate);
    if (gross === null || r.billing_day == null) { unscheduled++; continue; }
    const terms = Number(r.payment_terms_days ?? 0);
    for (let m = -1; m <= 3; m++) {
      const anchor = addMonthsIso(`${start.slice(0, 8)}01`, m);
      const billed = `${anchor.slice(0, 8)}${String(Math.min(Number(r.billing_day), 28)).padStart(2, '0')}`;
      const paid = addDaysIso(billed, terms + shift);
      if (paid < start || paid > end) continue;
      weeks[weekIdx(paid)].in += gross;
    }
  }
  if (unscheduled) missing.push({ key: 'retainer_schedule', count: unscheduled, text: `${unscheduled} retainers בלי billing_day לא נכנסו לתחזית` });

  // Outflows: fixed commitments and loan payments
  const commitments = input.commitments || [];
  if (!commitments.length) missing.push({ key: 'fixed_commitments', text: 'אין רשומות fixed-commitment: היציאות בתחזית חלקיות' });
  let monthlyFixed = commitments.length ? 0 : null;
  for (const c of commitments) {
    const gross = grossOf(c.amount, c.vat_included, vatRate);
    if (gross === null || !c.next_due) continue;
    monthlyFixed += gross * (PER_MONTH[c.frequency] ?? 0);
    for (const d of occurrences(c.next_due, c.frequency, end)) {
      const i = weekIdx(d);
      if (i !== null) weeks[i].out += gross;
    }
  }
  for (const l of input.loans || []) {
    const pay = kpi.toNum(l.monthly_payment);
    if (pay === null || !l.next_due) continue;
    monthlyFixed = (monthlyFixed ?? 0) + pay;
    for (const d of occurrences(l.next_due, 'monthly', end)) {
      const i = weekIdx(d);
      if (i !== null) weeks[i].out += pay;
    }
  }

  // Closing balances need an opening cash position
  const cash = cashPosition(input.cashAccounts || []);
  if (cash.operating === null) missing.push({ key: 'cash_account', text: 'אין רשומות cash-account: אין יתרת פתיחה, ולכן אין שבוע שפל' });
  let running = cash.operating;
  for (const w of weeks) {
    w.in = Math.round(w.in); w.out = Math.round(w.out);
    if (running !== null) { running += w.in - w.out; w.closing = Math.round(running); }
  }

  const trough = running === null ? null
    : weeks.reduce((min, w) => (min === null || w.closing < min.amount ? { week: w.start, amount: w.closing } : min), null);
  const floor = floorMonths !== null && monthlyFixed !== null ? Math.round(floorMonths * monthlyFixed) : null;
  const totalOut = weeks.reduce((s, w) => s + w.out, 0);
  const weeksOfSpend = cash.operating !== null && totalOut > 0 ? Math.round(cash.operating / (totalOut / WEEKS) * 10) / 10 : null;

  return {
    scenario, start, end, weeks, cash, trough, floor,
    below_floor: trough && floor !== null ? trough.amount < floor : null,
    weeks_of_spend: weeksOfSpend,
    partial: missing.length > 0,
    missing,
  };
}

function buildScenarios(input) {
  const base = buildForecast(input, 'base');
  const late = buildForecast(input, 'late_collection');
  const lose = buildForecast(input, 'lose_top_client');
  return { base, late_collection: late, lose_top_client: lose };
}

module.exports = { WEEKS, weekStart, addDaysIso, addMonthsIso, cashPosition, occurrences, buildForecast, buildScenarios };
