// Ventures math (stage 3.3) as pure functions: loans (Spitzer / annuity amortization), splitting a
// repayment into interest and principal and between the venture and the personal side, property
// yields and investment returns. Every function returns null when an input it needs is missing,
// never 0 (a missing number is "no data", not zero).
'use strict';

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const toNum = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const isIso = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// Fixed monthly payment of an annuity loan. rate = annual rate as a fraction (0.045 = 4.5%).
function monthlyPayment(principal, annualRate, termMonths) {
  const p = toNum(principal), r = toNum(annualRate), n = toNum(termMonths);
  if (p === null || r === null || n === null || p <= 0 || r < 0 || r >= 1 || n < 1 || !Number.isInteger(n)) return null;
  const i = r / 12;
  if (i === 0) return round2(p / n);
  return round2((p * i) / (1 - Math.pow(1 + i, -n)));
}

// One repayment against the current balance: interest = balance × rate / 12 (rounded to the agora),
// the rest reduces the balance. A payment smaller than the interest pays interest only.
// Paying more than interest + balance is refused ('too_much').
function splitPayment(balance, annualRate, amount) {
  const b = toNum(balance), r = toNum(annualRate), a = toNum(amount);
  if (b === null || r === null || a === null || b < 0 || r < 0 || r >= 1 || a <= 0) return { error: 'invalid' };
  if (b === 0) return { error: 'paid_off' };
  const due = round2((b * r) / 12);
  const interest = Math.min(round2(a), due);
  const principal = round2(a - interest);
  if (principal > round2(b) + 0.005) return { error: 'too_much' };
  return { interest, principal, balance_after: round2(Math.max(0, b - principal)) };
}

// Schedule from a balance forward: [{ n, date, payment, interest, principal, balance }].
// Stops when the balance reaches 0 or after `months` rows. The last payment is trimmed to what is left.
function amortizationSchedule(balance, annualRate, payment, months, startIso) {
  const b0 = toNum(balance), r = toNum(annualRate), pay = toNum(payment), m = toNum(months);
  if (b0 === null || r === null || pay === null || m === null || b0 <= 0 || pay <= 0 || r < 0 || r >= 1 || m < 1) return null;
  const rows = [];
  let b = round2(b0);
  for (let n = 1; n <= m && b > 0; n++) {
    const due = round2((b * r) / 12);
    if (pay <= due) return { rows, never_ends: true };   // the payment does not even cover the interest
    let amount = Math.min(pay, round2(b + due));
    let principal = round2(amount - due);
    // agorot left over from rounding the payment are paid with the last one
    if (b - principal > 0 && b - principal < 1) { principal = b; amount = round2(due + b); }
    b = round2(Math.max(0, b - principal));
    rows.push({ n, date: startIso && isIso(startIso) ? addMonths(startIso, n - 1) : null, payment: round2(amount), interest: due, principal, balance: b });
  }
  return { rows, never_ends: false };
}

// Months left until a balance is paid off at a fixed payment (null when the payment never ends it)
function monthsToPayoff(balance, annualRate, payment) {
  const s = amortizationSchedule(balance, annualRate, payment, 1200, null);
  if (!s || s.never_ends) return null;
  return s.rows.length;
}

function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

// A repayment is recorded in both places by the loan's split: venture_share_pct to the venture,
// the rest to the personal side. The two parts always add up to the amount (rounding goes personal).
function shareSplit(amount, venturePct) {
  const a = toNum(amount), p = toNum(venturePct);
  if (a === null || p === null || a <= 0 || p < 0 || p > 100) return null;
  const venture = round2((a * p) / 100);
  return { venture, personal: round2(a - venture) };
}

const ratio = (num, den) => (num === null || den === null || den <= 0 ? null : Math.round((num / den) * 100000) / 100000);

// Property yields over the last 12 months. Inputs (₪, ex-VAT, venture share only):
//   purchase_cost      what the property cost (incl. purchase costs)
//   loan_principal     the original principal of its loans (venture share)
//   income_12m         rent and other income
//   expenses_12m       operating expenses (not loan payments)
//   interest_12m       interest paid on its loans
//   principal_12m      principal repaid on its loans
// gross       = income / purchase cost
// net         = (income − expenses − interest) / equity, equity = purchase cost − loan principal
// cash_on_cash = (income − expenses − interest − principal) / equity
// Missing income → every yield null. No expense rows → treated as none only when income exists
// (an income row with no expense rows is a real "no expenses", the caller says how many months back).
function propertyYields(x) {
  const cost = toNum(x.purchase_cost);
  const loan = toNum(x.loan_principal) ?? 0;
  const income = toNum(x.income_12m);
  const expenses = toNum(x.expenses_12m) ?? 0;
  const interest = toNum(x.interest_12m) ?? 0;
  const principal = toNum(x.principal_12m) ?? 0;
  const equity = cost === null ? null : round2(cost - loan);
  if (income === null) {
    return { gross: null, net: null, cash_on_cash: null, equity: equity !== null && equity > 0 ? equity : null, noi: null, cash_flow: null };
  }
  const noi = round2(income - expenses - interest);
  const cashFlow = round2(noi - principal);
  return {
    gross: ratio(income, cost),
    net: ratio(noi, equity),
    cash_on_cash: ratio(cashFlow, equity),
    equity: equity !== null && equity > 0 ? equity : null,
    noi,
    cash_flow: cashFlow,
  };
}

// Investment return: gain, return on the amount, and annualized (only after a full year)
function investmentReturn(invested, value, investedOn, valueDate) {
  const a = toNum(invested), v = toNum(value);
  if (a === null || v === null || a <= 0 || v < 0) return { gain: null, pct: null, annualized: null };
  const gain = round2(v - a);
  const pct = ratio(gain, a);
  let annualized = null;
  if (isIso(investedOn) && isIso(valueDate)) {
    const days = (Date.parse(`${valueDate}T00:00:00Z`) - Date.parse(`${investedOn}T00:00:00Z`)) / 86400000;
    if (days >= 365) annualized = Math.round((Math.pow(v / a, 365 / days) - 1) * 100000) / 100000;
  }
  return { gain, pct, annualized };
}

// Annual rate typed as a percent ("4.5" → 0.045). 0 ≤ rate < 100%, at most 3 decimals of a percent.
function parseRatePct(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(/[%\s]/g, '');
  if (!/^\d{1,2}(\.\d{1,3})?$/.test(s)) return null;
  return Math.round(Number(s) * 1000) / 100000;
}

// Percent share 0–100 with up to 2 decimals
function parsePct(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(/[%\s]/g, '');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 100 ? n : null;
}

// Deadline state for a legal case: overdue / soon (≤ 7 days) / later / done
function deadlineState(dueIso, doneAt, todayIso) {
  if (doneAt) return 'done';
  if (!isIso(dueIso) || !isIso(todayIso)) return 'later';
  const days = Math.round((Date.parse(`${dueIso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86400000);
  if (days < 0) return 'overdue';
  if (days <= 7) return 'soon';
  return 'later';
}

module.exports = {
  round2, monthlyPayment, splitPayment, amortizationSchedule, monthsToPayoff, addMonths, shareSplit,
  propertyYields, investmentReturn, parseRatePct, parsePct, deadlineState,
};
