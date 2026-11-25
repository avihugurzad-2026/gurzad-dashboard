import { HttpError } from '../server.js';
import type { RevenueSnapshot } from '../../../shared/integrations.js';
import type { Adapter } from './index.js';

// Buyz (the owners' own business system). Read-only: GET /api/revenue.php with X-Api-Key.
// Docs: Buyz portal → אינטגרציות → BUYZ API → נתוני הכנסות.

const ALLOWED_HOST = /(^|\.)buyz\.co\.il$/i;
function baseUrl(config: Record<string, string>) {
  const raw = (config.base_url || 'https://buyz.co.il').trim().replace(/\/+$/, '');
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'כתובת שרת לא תקינה'); }
  // The key is sent to this host, so only Buyz's own domain is allowed.
  if (u.protocol !== 'https:' || !ALLOWED_HOST.test(u.hostname)) throw new HttpError(400, 'הכתובת חייבת להיות https ב־buyz.co.il');
  return u.origin;
}

async function revenue(config: Record<string, string>, secret: string, params: Record<string, string>) {
  const q = new URLSearchParams(params);
  const r = await fetch(`${baseUrl(config)}/api/revenue.php?${q}`, { headers: { 'X-Api-Key': secret, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  const j: any = await r.json().catch(() => null);
  if (r.status === 401 || r.status === 403) throw new HttpError(424, 'Buyz דחתה את המפתח. בדוק שהוא פעיל ומועתק במלואו.');
  if (!r.ok || !j || j.success === false) throw new HttpError(502, j?.error ? `Buyz: ${String(j.error).slice(0, 200)}` : `Buyz החזירה שגיאה (${r.status})`);
  return j.data && typeof j.data === 'object' ? j.data : j;
}

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const s = (v: unknown) => (v == null ? '' : String(v));

function normalize(year: any, month: any): RevenueSnapshot {
  const sum = month.summary ?? {};
  const bySource: Record<string, number> = {};
  const src = sum.by_source ?? {};
  for (const k of Object.keys(src)) bySource[k] = n(typeof src[k] === 'object' ? src[k]?.total ?? src[k]?.revenue_total : src[k]);
  const monthly = (year.monthly ?? []).map((m: any) => ({ month: s(m.month).slice(0, 7), total: n(m.revenue_total ?? m.total), count: n(m.count) }));
  return {
    currency: 'ILS',
    summary: { total: n(sum.revenue_total), count: n(sum.transactions_count), average: n(sum.average_transaction), unpaid: n(sum.unpaid_total), bySource },
    monthly,
    daily: (month.daily ?? []).map((d: any) => ({ date: s(d.date).slice(0, 10), total: n(d.revenue_total ?? d.total), count: n(d.count) })),
    methods: (month.by_payment_method ?? []).map((m: any) => ({ label: s(m.label || m.method), total: n(m.total), count: n(m.count) })),
    sellers: (month.sales?.by_seller ?? []).map((x: any) => ({ name: s(x.name ?? x.seller ?? x.label), total: n(x.total), count: n(x.count ?? x.orders_count) })),
    transactions: (month.transactions ?? []).slice(0, 50).map((t: any) => ({
      id: s(t.id ?? t.reference), date: s(t.date), amount: n(t.amount), type: s(t.type), status: s(t.payment_status),
      customer: s(t.customer_name), description: s(t.description),
    })),
    range: { monthsFrom: monthly[0]?.month ?? '', monthsTo: monthly[monthly.length - 1]?.month ?? '' },
  };
}

export const buyz: Adapter = {
  async test(config, secret) {
    const j = await revenue(config, secret, { period: 'today', include: 'summary' });
    return `החיבור תקין · היום ${Math.round(n(j.summary?.revenue_total)).toLocaleString('he-IL')} ₪`;
  },
  async sync(config, secret) {
    // Two calls: 12 months of monthly totals, and this month in detail.
    const [year, month] = await Promise.all([
      revenue(config, secret, { months: '12', include: 'monthly' }),
      revenue(config, secret, { period: 'this_month', include: 'summary,daily,methods,sales,transactions', limit: '50' }),
    ]);
    return { revenue: normalize(year, month) };
  },
};
