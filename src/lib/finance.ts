// Finance constants and period math (client-safe). Ids match the DB checks in migration 2.3/2.4.
import { addDays, periodBounds, todayIL } from '@/lib/period';

export type Direction = 'income' | 'expense';
export type Classification = 'business' | 'personal' | 'mixed';
type Use = 'business' | 'personal';
export type Category = { id: string; label: string; use: Use[] };

const B: Use[] = ['business'], P: Use[] = ['personal'], BP: Use[] = ['business', 'personal'];

export const INCOME_CATEGORIES: Category[] = [
  { id: 'client-payment', label: 'תקבול מלקוח', use: B },
  { id: 'retainer', label: 'ריטיינר', use: B },
  { id: 'project', label: 'פרויקט', use: B },
  { id: 'services', label: 'שירותים', use: B },
  { id: 'salary', label: 'משכורת', use: P },
  { id: 'business-draw', label: 'משיכה מהעסק', use: P },
  { id: 'rent-income', label: 'שכירות', use: BP },
  { id: 'refund', label: 'החזר', use: BP },
  { id: 'other', label: 'אחר', use: BP },
];

export const EXPENSE_CATEGORIES: Category[] = [
  { id: 'software', label: 'תוכנה ושירותי ענן', use: B },
  { id: 'advertising', label: 'פרסום', use: B },
  { id: 'contractors', label: 'קבלני משנה', use: B },
  { id: 'office', label: 'משרד וציוד', use: B },
  { id: 'professional', label: 'ייעוץ מקצועי (רו״ח, עו״ד)', use: B },
  { id: 'salaries', label: 'שכר עובדים', use: B },
  { id: 'taxes', label: 'מסים ואגרות', use: BP },
  { id: 'bank-fees', label: 'עמלות בנק', use: BP },
  { id: 'insurance', label: 'ביטוח', use: BP },
  { id: 'travel', label: 'נסיעות', use: BP },
  { id: 'car', label: 'רכב ודלק', use: BP },
  { id: 'rent', label: 'שכירות / משכנתא', use: BP },
  { id: 'groceries', label: 'סופר', use: P },
  { id: 'utilities', label: 'חשבונות', use: P },
  { id: 'kids', label: 'ילדים', use: P },
  { id: 'health', label: 'בריאות', use: P },
  { id: 'education', label: 'לימודים', use: P },
  { id: 'leisure', label: 'בילויים', use: P },
  { id: 'clothing', label: 'ביגוד', use: P },
  { id: 'subscriptions', label: 'מנויים', use: BP },
  { id: 'other', label: 'אחר', use: BP },
];

export const categoriesOf = (dir: Direction, use?: Use) =>
  (dir === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).filter(c => !use || c.use.includes(use));
export const isCategory = (dir: Direction, id: string) => categoriesOf(dir).some(c => c.id === id);
export const categoryName = (dir: Direction, id: string) =>
  categoriesOf(dir).find(c => c.id === id)?.label ?? id;

export const DOCUMENT_TYPES = [
  { id: 'tax_invoice', label: 'חשבונית מס' },
  { id: 'receipt', label: 'קבלה' },
  { id: 'tax_invoice_receipt', label: 'חשבונית מס/קבלה' },
  { id: 'transaction_invoice', label: 'חשבון עסקה' },
  { id: 'other', label: 'מסמך אחר' },
  { id: 'none', label: 'אין מסמך' },
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number]['id'];

export const PAYMENT_METHODS = [
  { id: 'transfer', label: 'העברה בנקאית' },
  { id: 'card', label: 'כרטיס אשראי' },
  { id: 'cash', label: 'מזומן' },
  { id: 'check', label: 'צ׳ק' },
  { id: 'other', label: 'אחר' },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['id'];

export const CLASSIFICATIONS = [
  { id: 'business', label: 'עסקי' },
  { id: 'personal', label: 'פרטי' },
  { id: 'mixed', label: 'מעורב' },
] as const;

export const DIRECTIONS = [
  { id: 'income', label: 'הכנסה' },
  { id: 'expense', label: 'הוצאה' },
] as const;

export const labelOf = (list: readonly { id: string; label: string }[], id: string | null | undefined) =>
  list.find(x => x.id === id)?.label ?? (id ?? '');

// ── Period presets (Israel time; week = Sunday–Saturday) ──────────────────────
export const PERIODS = [
  { key: 'today', label: 'היום' },
  { key: 'week', label: 'השבוע' },
  { key: 'month', label: 'החודש' },
  { key: 'quarter', label: 'הרבעון' },
  { key: 'year', label: 'השנה' },
  { key: 'custom', label: 'טווח…' },
] as const;
export type PeriodKey = (typeof PERIODS)[number]['key'];

const ISO = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

// Search params → a concrete range. Custom needs valid from ≤ to (max ~5 years), else falls back to month.
export function resolvePeriod(p: unknown, from: unknown, to: unknown, today = todayIL()): { key: PeriodKey; from: string; to: string } {
  const key = PERIODS.some(x => x.key === p) ? (p as PeriodKey) : 'month';
  if (key === 'custom') {
    if (isIsoDate(from) && isIsoDate(to) && from <= to && from >= addDays(to, -1900)) return { key, from, to };
    const b = periodBounds('month', today);
    return { key: 'month', from: b.start, to: b.end };
  }
  const b = periodBounds(key, today);
  return { key, from: b.start, to: b.end };
}

// Dated VAT parameter rows as the page hands them to the form: [{ from: 'YYYY-MM-DD', rate }]
export type VatRateRow = { from: string; rate: number };
export function vatRateOn(rows: VatRateRow[], dateIso: string): number | null {
  let best: VatRateRow | null = null;
  for (const r of rows) if (r.from <= dateIso && (!best || r.from > best.from)) best = r;
  return best ? best.rate : null;
}
