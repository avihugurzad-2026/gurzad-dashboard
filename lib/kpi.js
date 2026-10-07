// KPI calculations as pure functions over entity rows (entity.data from the DB
// or vault frontmatter). Rule: no data → null (shown as "אין נתונים עדיין"), never 0.
'use strict';

const CLOSED_STATUSES = ['paid', 'void', 'archived'];

const toNum = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const round2 = n => Math.round(n * 100) / 100;

function sumOrNull(values) {
  const xs = values.map(toNum).filter(x => x !== null);
  return xs.length ? round2(xs.reduce((a, b) => a + b, 0)) : null;
}

function isOpen(status) {
  return !status || !CLOSED_STATUSES.includes(status);
}

// Monthly fee of a retainer, ex-VAT. Vault uses amount_net; BUILD-SPEC names it monthly_fee_net.
function retainerFeeNet(r) {
  return toNum(r.amount_net ?? r.monthly_fee_net);
}

// MRR = Σ monthly fee (ex-VAT) of active retainers
function mrr(retainers) {
  return sumOrNull(retainers.filter(r => r.status === 'active').map(retainerFeeNet));
}

// Open debts incl. VAT (amount_gross − paid_amount)
function openDebtsGross(debts) {
  return sumOrNull(debts.filter(d => isOpen(d.status)).map(outstandingGross));
}

function outstandingGross(d) {
  const gross = toNum(d.amount_gross);
  if (gross === null) return null;
  return round2(gross - (toNum(d.paid_amount) ?? 0));
}

// Client concentration over active retainers: top-3 share of MRR
function concentration(retainers) {
  const active = retainers
    .filter(r => r.status === 'active' && retainerFeeNet(r) !== null)
    .map(r => ({ name: r.client ?? null, fee_net: retainerFeeNet(r) }));
  const total = sumOrNull(active.map(r => r.fee_net));
  if (!total) return null;
  active.sort((a, b) => b.fee_net - a.fee_net);
  const top3 = active.slice(0, 3).map(r => ({ ...r, pct: Math.round(r.fee_net / total * 100) }));
  return { top_3: top3, max_pct: top3[0].pct, total_clients: active.length };
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
}

// Aging buckets (incl. VAT) by days past due_date. Items without due_date can't be
// aged: if none has one, result is null; otherwise they're counted in missing_due_date.
function aging(items, todayIso) {
  const open = items.filter(i => isOpen(i.status));
  const dated = open.filter(i => i.due_date);
  if (!dated.length) return null;

  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const i of dated) {
    const amt = outstandingGross(i);
    if (!amt || amt <= 0) continue;
    const days = daysBetween(i.due_date, todayIso);
    const key = days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus';
    buckets[key] = round2(buckets[key] + amt);
  }
  return { buckets, missing_due_date: open.length - dated.length };
}

function vatAmount(net, rate) {
  const n = toNum(net), r = toNum(rate);
  return n === null || r === null ? null : round2(n * r);
}

function grossFromNet(net, rate) {
  const n = toNum(net), r = toNum(rate);
  return n === null || r === null ? null : round2(n * (1 + r));
}

// Estimated VAT payable = output VAT (sales) − input VAT (purchases)
function vatEstimate(sales, purchases) {
  const out = sumOrNull(sales.map(d => d.vat_amount ?? vatAmount(d.amount_net, d.vat_rate)));
  const inp = sumOrNull(purchases.map(d => d.vat_amount ?? vatAmount(d.amount_net, d.vat_rate)));
  if (out === null && inp === null) return null;
  return round2((out ?? 0) - (inp ?? 0));
}

// Only a tax invoice above the threshold (ex-VAT) needs an allocation number.
// Returns null when it can't be decided (not an invoice, or no threshold for the date).
function allocationRequired(doc, threshold) {
  if (doc.type !== 'invoice') return null;
  const net = toNum(doc.amount_net);
  if (net === null || threshold === null || threshold === undefined) return null;
  return net > threshold;
}

module.exports = {
  CLOSED_STATUSES, toNum, sumOrNull, isOpen,
  retainerFeeNet, mrr, openDebtsGross, outstandingGross, concentration,
  daysBetween, aging, vatAmount, grossFromNet, vatEstimate, allocationRequired,
};
