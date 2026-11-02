// Types for the tested CommonJS KPI module (shared by the Next app and the sync script)
type Rec = Record<string, unknown>;

declare const kpi: {
  CLOSED_STATUSES: string[];
  toNum(v: unknown): number | null;
  sumOrNull(values: unknown[]): number | null;
  isOpen(status: unknown): boolean;
  retainerFeeNet(r: Rec): number | null;
  mrr(retainers: Rec[]): number | null;
  openDebtsGross(debts: Rec[]): number | null;
  outstandingGross(d: Rec): number | null;
  concentration(retainers: Rec[]): { top_3: { name: string | null; fee_net: number; pct: number }[]; max_pct: number; total_clients: number } | null;
  daysBetween(fromIso: string, toIso: string): number;
  aging(items: Rec[], todayIso: string): { buckets: Record<string, number>; missing_due_date: number } | null;
  vatAmount(net: number | null, rate: number | null): number | null;
  grossFromNet(net: number | null, rate: number | null): number | null;
  vatEstimate(sales: unknown, purchases: unknown): unknown;
  allocationRequired(doc: Rec, threshold: number | null): boolean;
};
export = kpi;
