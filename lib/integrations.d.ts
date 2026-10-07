declare namespace integrations {
  type Named = { name: string; count: number | null; total: number | null };
  type MonthSummary = {
    month: string; revenue_total: number | null; tx_count: number | null; average_transaction: number | null; unpaid_total: number | null;
    bookings_total: number | null; bookings_count: number | null; vouchers_total: number | null; vouchers_count: number | null;
    sales_total: number | null; sales_count: number | null; orders_count: number | null;
    customers_count: number | null; new_customers_count: number | null; cancellations_count: number | null;
  };
  type Mapped = {
    account: string | null; summary: MonthSummary;
    daily: { day: string; revenue_total: number; tx_count: number | null; bookings: number | null; vouchers: number | null; sales: number | null }[];
    items: Named[]; staff: Named[]; methods: { method: string; label: string; count: number | null; total: number | null }[];
  };
  type Counts = { months_added: number; months_changed: number; days: number; items: number; staff: number; methods: number; months_detail: number };
  type SyncResult = ({ ok: true } | { ok: false; code: string; error: string }) & { id: string; location: string } & Counts;
  type Integration = { id: string; provider: string; domain: string; branch: string; location: string; credentials_ref: string | null; config: Record<string, unknown> };
  type SyncOpts = { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; today: string; userId?: string | null };
  type BranchNumbers = Partial<Record<'today_incl' | 'today_ex' | 'month_incl' | 'month_ex' | 'last_month_ex' | 'ytd_ex' | 'tx' | 'bookings_count' | 'customers' | 'cancellations' | 'unpaid_incl', number | null>>;
  type Aggregate = Record<'today_incl' | 'today_ex' | 'month_incl' | 'month_ex' | 'last_month_ex' | 'ytd_ex' | 'tx' | 'bookings_count' | 'customers' | 'cancellations' | 'unpaid_incl' | 'avg_ticket_incl', number | null> & { branches_with_data: number };
  type GoalsProgress = { total: number; done: number; active: number; avg_pct: number | null } | null;
}
declare const integrations: {
  ERROR_TEXT: Record<string, string>;
  BUYZ_PARTS: string;
  SyncError: new (code: string, message: string) => Error & { code: string };
  resolveCredential(provider: string, ref: string | null | undefined, env?: Record<string, string | undefined>): string;
  mapBuyzMonth(raw: unknown, month: string): integrations.Mapped;
  fetchBuyzMonth(opts: { key: string; month: string; today?: string; fetchImpl?: typeof fetch }): Promise<unknown>;
  monthRange(month: string, today?: string): { from: string; to: string };
  prevMonth(month: string): string;
  aggregateBranches(branches: integrations.BranchNumbers[]): integrations.Aggregate;
  goalsProgress(goals: { status: string; target: number | null; current: number | null }[]): integrations.GoalsProgress;
  syncBuyz(pool: unknown, integ: integrations.Integration, opts: integrations.SyncOpts): Promise<integrations.SyncResult>;
  syncAll(pool: unknown, opts: integrations.SyncOpts): Promise<integrations.SyncResult[]>;
};
export = integrations;
