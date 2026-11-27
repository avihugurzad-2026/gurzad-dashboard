import { HttpError, israelDay } from '../server.js';
import type { RevenueSnapshot } from '../../../shared/integrations.js';
import type { Adapter } from './index.js';

// Morning (formerly Green Invoice). API key = id + secret from Morning → הגדרות → כלים למפתחים → מפתחות API.
// Read-only: we only call token + documents/search + expenses/search.
const HOST = 'https://api.greeninvoice.co.il/api/v1';

async function token(id: string, secret: string) {
  const r = await fetch(`${HOST}/account/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, secret }), signal: AbortSignal.timeout(15000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new HttpError(424, 'מורנינג דחתה את המפתח. בדוק את ה־ID וה־Secret.');
  return j.token as string;
}
async function post(tok: string, path: string, body: unknown) {
  const r = await fetch(`${HOST}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const j: any = await r.json().catch(() => null);
  if (!r.ok || !j) throw new HttpError(502, `מורנינג החזירה שגיאה (${r.status})${j?.errorMessage ? ': ' + String(j.errorMessage).slice(0, 150) : ''}`);
  return j;
}

// Document types that count as revenue: 305 tax invoice, 320 tax invoice-receipt; 330 credit note subtracts.
const REVENUE_TYPES = [305, 320, 330];
const TYPE_LABEL: Record<number, string> = { 305: 'חשבונית מס', 320: 'חשבונית מס קבלה', 330: 'חשבונית זיכוי' };

async function allDocs(tok: string, fromDate: string, toDate: string) {
  const out: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const j = await post(tok, '/documents/search', { fromDate, toDate, type: REVENUE_TYPES, page, pageSize: 100, sort: 'documentDate' });
    out.push(...(j.items ?? []));
    if (!j.items?.length || out.length >= (j.total ?? 0)) break;
  }
  return out;
}

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
// The secret is stored as "id:secret" (one sealed value).
const parts = (secret: string) => { const i = secret.indexOf(':'); return [secret.slice(0, i), secret.slice(i + 1)]; };

export const morning: Adapter = {
  combineSecret: (fields) => `${fields.api_id}:${fields.api_secret}`,
  async test(_config, secret) {
    const [id, sec] = parts(secret);
    await token(id, sec);
    return 'החיבור למורנינג תקין';
  },
  async sync(_config, secret) {
    const [id, sec] = parts(secret);
    const tok = await token(id, sec);
    const today = israelDay();
    const start = new Date(today.slice(0, 7) + '-01T12:00:00Z'); start.setUTCMonth(start.getUTCMonth() - 11);
    const fromDate = start.toISOString().slice(0, 10), thisMonth = today.slice(0, 7);
    const docs = await allDocs(tok, fromDate, today);

    // amount before VAT when available (dashboard rule: amounts ex-VAT), sign by type
    const net = (d: any) => (d.type === 330 ? -1 : 1) * Math.abs(n(d.amountExcludeVat ?? d.amount));
    const months = new Map<string, { total: number; count: number }>();
    for (let i = 0; i < 12; i++) { const m = new Date(start); m.setUTCMonth(start.getUTCMonth() + i); months.set(m.toISOString().slice(0, 7), { total: 0, count: 0 }); }
    const daily = new Map<string, { total: number; count: number }>();
    const clients = new Map<string, { total: number; count: number }>();
    let unpaid = 0;
    for (const d of docs) {
      const date = String(d.documentDate || '').slice(0, 10), ym = date.slice(0, 7);
      const m = months.get(ym); if (m) { m.total += net(d); m.count++; }
      if (ym === thisMonth) {
        const x = daily.get(date) ?? { total: 0, count: 0 }; x.total += net(d); x.count++; daily.set(date, x);
        const name = d.client?.name || 'ללא לקוח';
        const c = clients.get(name) ?? { total: 0, count: 0 }; c.total += net(d); c.count++; clients.set(name, c);
        if (d.type === 305 && d.status !== 1) unpaid += net(d); // 305 not closed by a receipt
      }
    }
    const cur = months.get(thisMonth) ?? { total: 0, count: 0 };
    const monthDocs = docs.filter((d) => String(d.documentDate || '').startsWith(thisMonth));
    const snap: RevenueSnapshot = {
      currency: 'ILS',
      summary: { total: cur.total, count: cur.count, average: cur.count ? cur.total / cur.count : 0, unpaid, bySource: {} },
      monthly: [...months].map(([month, v]) => ({ month, ...v })),
      daily: [...daily].sort().map(([date, v]) => ({ date, ...v })),
      methods: [],
      sellers: [...clients].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total),
      transactions: monthDocs.slice(-50).reverse().map((d) => ({ id: String(d.number ?? d.id), date: String(d.documentDate).slice(0, 10), amount: net(d), type: TYPE_LABEL[d.type] ?? String(d.type), status: String(d.status ?? ''), customer: d.client?.name ?? '', description: d.description ?? '' })),
      sellersTitle: 'הכנסות לפי לקוח', vatIncluded: false,
      range: { monthsFrom: fromDate.slice(0, 7), monthsTo: thisMonth },
    };
    return { revenue: snap };
  },
};
