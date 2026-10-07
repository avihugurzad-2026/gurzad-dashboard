// Types for the tested CommonJS money module (transactions, VAT inside amounts, collections, CSV)
type Rec = Record<string, unknown>;

declare const money: {
  round2(n: number): number;
  toNum(v: unknown): number | null;
  vatSplit(gross: unknown, rate: number | null, included: boolean): { gross: number; vat: number; net: number } | null;
  parseAmount(v: unknown): number | null;
  validTaxId(v: unknown): boolean;
  validSplits(splits: { user_id: string; share_pct: number }[]): boolean;
  daysBetween(fromIso: string, toIso: string): number;
  receivableView(r: Rec, todayIso: string): { status: 'paid' | 'overdue' | 'partial' | 'pending'; remaining: number; days_overdue: number | null };
  applyPayment(amount: unknown, amountPaid: unknown, payment: unknown):
    { error: 'invalid' | 'already_paid' | 'too_much' } | { amount_paid: number; status: 'paid' | 'partial'; remaining: number; error?: undefined };
  csvCell(v: unknown): string;
  csvRow(cells: unknown[]): string;
  toCsv(header: string[], rows: unknown[][]): string;
};
export = money;
