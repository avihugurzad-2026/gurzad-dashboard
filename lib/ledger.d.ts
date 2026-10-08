// Types for the tested CommonJS ledger module (personal / household finance engine)
type Rec = Record<string, unknown>;
type Recurring = { frequency: string; interval_months?: number | null; day_of_month?: number | null; start_date?: string | null; end_date?: string | null; next_due?: string | null; amount?: number | string };
type Plan = { id?: string; user_id?: string; name?: string; rule: 'fixed' | 'percentage' | 'manual'; amount?: number | string | null; percentage?: number | string | null;
  status: string; start_date?: string | null; end_date?: string | null; frequency?: string; day_of_month?: number | null };
type Rule = { id?: string; pattern: string; match_field?: string; match_type?: string; priority?: number; active?: boolean } & Rec;

declare const ledger: {
  round2(n: number): number;
  monthStart(iso: string): string;
  addMonths(iso: string, n: number): string;
  dayInMonth(iso: string, day: number): string;
  stepMonths(frequency: string, intervalMonths?: number | null): number | null;
  nextDue(r: Recurring, fromIso: string): string | null;
  advanceDue(r: Recurring, dueIso: string): string | null;
  monthlyEquivalent(r: Recurring): number;
  budgetView(lines: { category_id: string; name: string; budget: number }[], actuals: Record<string, number>): {
    rows: { category_id: string; name: string; budget: number; actual: number; remaining: number; variance: number; pct: number | null; over: boolean }[];
    unbudgeted: { category_id: string; actual: number }[];
    totals: { budget: number; actual: number; remaining: number; variance: number };
  };
  savingsView(g: { target_amount: number | string; current_amount?: number | string | null; monthly_contribution?: number | string | null; deadline?: string | null }, todayIso: string): {
    target: number; current: number; left: number; pct: number | null; monthsLeft: number | null; needPerMonth: number | null; onTrack: boolean | null; reached: boolean;
  };
  contributionDue(c: Plan, incomeForPeriod?: number | null): number | null;
  contributionActive(c: Plan, period: string): boolean;
  contributionMonth(plans: (Plan & { id: string; user_id: string; name: string })[], payments: { contribution_id: string; user_id: string; amount: number | string; status: string }[], period: string): {
    rows: { contribution_id: string; user_id: string; name: string; expected: number | null; received: number; pending: number | null; status: 'received' | 'partial' | 'pending' }[];
    expected: number | null; received: number | null; pending: number | null;
  };
  nextContribution(c: Plan, todayIso: string): string | null;
  normalizeMerchant(s: string | null | undefined): string;
  matchRule<R extends Rule>(rules: R[], tx: { merchant?: string | null; description?: string | null }): R | null;
  dedupeKey(occurredOn: string, amount: number | string, merchant: string | null | undefined): string;
  isDuplicate<T extends { amount: number | string; occurred_on: string; merchant?: string | null; description?: string | null }>(
    candidate: { amount: number | string; occurred_on: string; merchant?: string | null; description?: string | null }, existing: T[]): T | null;
  defaultWorkspace(account: { workspace_id?: string | null } | null | undefined, personalWorkspaceId: string): string;
};
export = ledger;
