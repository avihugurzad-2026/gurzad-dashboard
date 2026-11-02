declare namespace revenue {
  type Month = { month: string; revenue_total: number; tx_count: number | null; bookings: number | null; vouchers: number | null; sales: number | null };
  type IngestResult = { account: string; months: number; added: number; changed: number; unchanged: number; snapshots: number; dry: boolean };
}
declare const revenue: {
  normalizeBuyz(raw: unknown): { account: string; name: string | null; months: revenue.Month[] };
  buildRevenueSnapshots(rows: unknown[], params: unknown[]): { period: string; kpi_key: string; domain: string; branch: string; basis: string; vat_basis: string; value: number }[];
  fetchBuyz(opts: { key: string | undefined; query: Record<string, string | number>; fetchImpl?: typeof fetch }): Promise<unknown>;
  ingestBuyz(pool: unknown, opts: { key: string | undefined; query: Record<string, string | number>; dry?: boolean; fetchImpl?: typeof fetch }): Promise<revenue.IngestResult>;
};
export = revenue;
