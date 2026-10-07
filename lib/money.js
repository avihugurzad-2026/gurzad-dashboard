// Money math for transactions and collections (stage 2.3/2.4) as pure functions.
// The VAT rate is always passed in (from `parameters`, per date); nothing here knows a rate.
'use strict';

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const toNum = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// VAT inside a gross amount. included=false → the amount carries no VAT (vat 0, net = gross).
// included=true with no known rate → null (the caller refuses; never a default rate).
function vatSplit(gross, rate, included) {
  const g = toNum(gross);
  if (g === null || g < 0) return null;
  if (!included) return { gross: round2(g), vat: 0, net: round2(g) };
  if (typeof rate !== 'number' || !(rate >= 0) || rate >= 1) return null;
  const vat = round2((g * rate) / (1 + rate));
  return { gross: round2(g), vat, net: round2(g - vat) };
}

// Parse a typed amount: "1,234.5" → 1234.5. Positive, at most 2 decimals, below 10^12.
function parseAmount(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(/[,\s₪]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n < 1e12 ? n : null;
}

// Israeli tax id / company number: digits only, 5–9 (checksum rules to confirm with the accountant)
const validTaxId = v => typeof v === 'string' && /^\d{5,9}$/.test(v);

// Split shares: [{ user_id, share_pct }] — unique users, each in (0, 100], summing to 100
function validSplits(splits) {
  if (!Array.isArray(splits) || splits.length < 2) return false;
  const seen = new Set();
  let sum = 0;
  for (const s of splits) {
    const p = toNum(s && s.share_pct);
    if (!s || typeof s.user_id !== 'string' || seen.has(s.user_id) || p === null || p <= 0 || p > 100) return false;
    if (round2(p) !== p) return false;
    seen.add(s.user_id);
    sum += p;
  }
  return Math.abs(sum - 100) < 0.005;
}

function daysBetween(fromIso, toIso) {
  const d = s => Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`);
  return Math.round((d(toIso) - d(fromIso)) / 86400000);
}

// Status shown for a receivable. Stored pending/partial/paid; overdue is computed from the due date.
function receivableView(r, todayIso) {
  const amount = toNum(r.amount) ?? 0;
  const paid = toNum(r.amount_paid) ?? 0;
  const remaining = round2(Math.max(0, amount - paid));
  if (r.status === 'paid' || remaining === 0) return { status: 'paid', remaining: 0, days_overdue: null };
  const late = r.due_date ? daysBetween(r.due_date, todayIso) : 0;
  if (late > 0) return { status: 'overdue', remaining, days_overdue: late };
  return { status: paid > 0 ? 'partial' : 'pending', remaining, days_overdue: null };
}

// A payment against a receivable → new paid amount and stored status, or an error code
function applyPayment(amount, amountPaid, payment) {
  const a = toNum(amount), p = toNum(amountPaid) ?? 0, x = toNum(payment);
  if (a === null || x === null || x <= 0) return { error: 'invalid' };
  const remaining = round2(a - p);
  if (remaining <= 0) return { error: 'already_paid' };
  if (round2(x) > remaining) return { error: 'too_much' };
  const paid = round2(p + x);
  return { amount_paid: paid, status: paid >= a ? 'paid' : 'partial', remaining: round2(a - paid) };
}

// ── CSV (UTF-8 BOM, CRLF, every field quoted, formula-injection guard) ─────────
function csvCell(v) {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
const csvRow = cells => cells.map(csvCell).join(',');
function toCsv(header, rows) {
  return '﻿' + [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}

module.exports = { round2, toNum, vatSplit, parseAmount, validTaxId, validSplits, daysBetween, receivableView, applyPayment, csvCell, csvRow, toCsv };
