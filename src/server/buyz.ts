import 'server-only';

// Buyz is the booking/POS system of Head Spa Israel (OSPA). Revenue only: it has no expenses,
// so nothing here is profit. Server-side only; the key never reaches the browser.
// We never request `transactions` (customer names): a sales report does not need them.

const ENDPOINT = 'https://buyz.co.il/api/revenue.php';
const PARTS = 'summary,monthly,daily,methods,sales';
const CACHE_SECONDS = 900;

export type BuyzSource = { bookings: number | null; vouchers: number | null; sales: number | null };
export type BuyzPeriod = { label: string; revenue_total: number | null; count: number | null } & BuyzSource;
export type BuyzReport = {
  summary: {
    revenue_total: number | null; transactions_count: number | null;
    average_transaction: number | null; unpaid_total: number | null; by_source: BuyzSource;
  };
  monthly: BuyzPeriod[];
  daily: BuyzPeriod[];
  methods: { method: string; label: string; count: number | null; total: number | null }[];
  sales: {
    orders_count: number | null; total: number | null; average_order: number | null;
    top_items: { name: string; count: number | null; total: number | null }[];
    by_seller: { name: string; count: number | null; total: number | null }[];
  } | null;
};

export type BuyzResult =
  | { ok: true; report: BuyzReport; fetched_at: string }
  | { ok: false; reason: 'no_key' | 'unauthorized' | 'unreachable' | 'bad_response' };

export type BuyzQuery =
  | { period: 'today' | 'yesterday' | 'this_week' | 'last_7_days' | 'last_30_days' | 'this_month' | 'last_month' | 'this_year' | 'last_year' }
  | { months: number }
  | { from: string; to: string };

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(x) ? x : null;
}
const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

function source(o: any): BuyzSource {
  return { bookings: n(o?.bookings), vouchers: n(o?.vouchers), sales: n(o?.sales) };
}

// Field names follow the documented response; anything missing stays null, never 0
export function parseReport(raw: any): BuyzReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw.data && typeof raw.data === 'object' && !raw.summary ? raw.data : raw;
  if (!d.summary && !d.monthly) return null;
  const sm = d.summary ?? {};
  const named = (x: any) => ({ name: s(x?.name ?? x?.title ?? x?.label ?? x?.seller), count: n(x?.count ?? x?.qty ?? x?.quantity), total: n(x?.total ?? x?.revenue) });
  return {
    summary: {
      revenue_total: n(sm.revenue_total), transactions_count: n(sm.transactions_count),
      average_transaction: n(sm.average_transaction), unpaid_total: n(sm.unpaid_total),
      by_source: source(sm.by_source),
    },
    monthly: arr(d.monthly).map(m => ({ label: s(m.month), revenue_total: n(m.revenue_total), count: n(m.count), ...source(m) })),
    daily: arr(d.daily).map(m => ({ label: s(m.date), revenue_total: n(m.revenue_total), count: n(m.count), ...source(m) })),
    methods: arr(d.by_payment_method).map(m => ({ method: s(m.method), label: s(m.label || m.method), count: n(m.count), total: n(m.total) })),
    sales: d.sales ? {
      orders_count: n(d.sales.orders_count), total: n(d.sales.total), average_order: n(d.sales.average_order),
      top_items: arr(d.sales.top_items).map(named), by_seller: arr(d.sales.by_seller).map(named),
    } : null,
  };
}

async function get(url: URL, headers: Record<string, string>) {
  return fetch(url, { headers: { Accept: 'application/json', ...headers }, next: { revalidate: CACHE_SECONDS } });
}

export async function buyzReport(query: BuyzQuery): Promise<BuyzResult> {
  const key = process.env.BUYZ_API_KEY;
  if (!key) return { ok: false, reason: 'no_key' };

  const url = new URL(ENDPOINT);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  url.searchParams.set('include', PARTS);

  try {
    // The docs do not say how the key is sent: try headers first, then the query string
    let res = await get(url, { 'X-API-Key': key, Authorization: `Bearer ${key}` });
    if (res.status === 401 || res.status === 403) {
      const withKey = new URL(url);
      withKey.searchParams.set('api_key', key);
      res = await get(withKey, {});
    }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized' };
    if (!res.ok) return { ok: false, reason: 'unreachable' };
    const report = parseReport(await res.json().catch(() => null));
    if (!report) return { ok: false, reason: 'bad_response' };
    return { ok: true, report, fetched_at: new Date().toISOString() };
  } catch {
    // Never log the URL: it may carry the key
    return { ok: false, reason: 'unreachable' };
  }
}

export const BUYZ_ERROR: Record<Exclude<BuyzResult, { ok: true }>['reason'], string> = {
  no_key: 'חסר המשתנה BUYZ_API_KEY בסביבה הזו',
  unauthorized: 'Buyz דחה את המפתח',
  unreachable: 'Buyz לא זמין כרגע',
  bad_response: 'Buyz החזיר תשובה במבנה לא צפוי',
};
