// Dated parameter lookup (VAT rate, allocation threshold, alert thresholds).
// No hardcoded fallbacks: a missing parameter is null, and callers show it as missing.
'use strict';

// rows: [{ key, effective_from: 'YYYY-MM-DD' | Date, value: {...} }]
function paramAt(rows, key, dateStr) {
  let best = null;
  for (const r of rows) {
    if (r.key !== key) continue;
    const from = r.effective_from instanceof Date
      ? r.effective_from.toISOString().split('T')[0]
      : String(r.effective_from);
    if (from > dateStr) continue;
    if (!best || from > best.from) best = { from, value: r.value };
  }
  return best ? best.value : null;
}

function vatRateAt(rows, dateStr) {
  const v = paramAt(rows, 'vat_rate', dateStr);
  return typeof v?.rate === 'number' ? v.rate : null;
}

function allocationThresholdAt(rows, dateStr) {
  const v = paramAt(rows, 'allocation_threshold', dateStr);
  return typeof v?.amount === 'number' ? v.amount : null;
}

module.exports = { paramAt, vatRateAt, allocationThresholdAt };
