// Types for the tested CommonJS ventures module (loans, repayment split, yields, investment return)
export type ScheduleRow = { n: number; date: string | null; payment: number; interest: number; principal: number; balance: number };
export type Yields = {
  gross: number | null; net: number | null; cash_on_cash: number | null;
  equity: number | null; noi: number | null; cash_flow: number | null;
};

declare const ventures: {
  round2(n: number): number;
  monthlyPayment(principal: unknown, annualRate: unknown, termMonths: unknown): number | null;
  splitPayment(balance: unknown, annualRate: unknown, amount: unknown):
    { error: 'invalid' | 'paid_off' | 'too_much' } | { interest: number; principal: number; balance_after: number; error?: undefined };
  amortizationSchedule(balance: unknown, annualRate: unknown, payment: unknown, months: unknown, startIso: string | null):
    { rows: ScheduleRow[]; never_ends: boolean } | null;
  monthsToPayoff(balance: unknown, annualRate: unknown, payment: unknown): number | null;
  addMonths(iso: string, n: number): string;
  shareSplit(amount: unknown, venturePct: unknown): { venture: number; personal: number } | null;
  propertyYields(x: {
    purchase_cost: number | null; loan_principal?: number | null; income_12m: number | null;
    expenses_12m?: number | null; interest_12m?: number | null; principal_12m?: number | null;
  }): Yields;
  investmentReturn(invested: unknown, value: unknown, investedOn: string | null, valueDate: string | null):
    { gain: number | null; pct: number | null; annualized: number | null };
  parseRatePct(v: unknown): number | null;
  parsePct(v: unknown): number | null;
  deadlineState(dueIso: string | null, doneAt: string | null, todayIso: string): 'overdue' | 'soon' | 'later' | 'done';
};
export = ventures;
