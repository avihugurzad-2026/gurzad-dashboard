import { createSign } from 'node:crypto';
import { env, has, HttpError } from './server.js';

// Website data from Google Analytics 4 (visits) and Search Console (Google search), read with one Google service account.
// Setup: create a service account in Google Cloud, enable "Google Analytics Data API" and "Search Console API",
// paste its JSON key into GOOGLE_SERVICE_ACCOUNT_JSON, then add the service account's email as a Viewer
// on each GA4 property and as a user on each Search Console property.
export const sitesReady = () => has('GOOGLE_SERVICE_ACCOUNT_JSON');

type Sa = { client_email: string; private_key: string };
function sa(): Sa {
  try {
    const raw = env('GOOGLE_SERVICE_ACCOUNT_JSON');
    const j = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    return { client_email: j.client_email, private_key: String(j.private_key).replace(/\\n/g, '\n') };
  } catch { throw new HttpError(503, 'מפתח חשבון השירות של גוגל לא תקין'); }
}
export const serviceEmail = () => (sitesReady() ? sa().client_email : null);

let tok: { value: string; exp: number } | null = null;
async function token() {
  if (tok && tok.exp > Date.now() + 60e3) return tok.value;
  const { client_email, private_key } = sa();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, 'ההתחברות לגוגל נכשלה (חשבון שירות)');
  tok = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return tok.value;
}

async function gpost(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new HttpError(r.status === 403 || r.status === 404 ? 424 : 502, j.error?.message || 'Google API error'); (e as any).status403 = r.status === 403; throw e; }
  return j;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const nn = (v: unknown) => Number(v ?? 0) || 0;

export type SiteReport = {
  ga: null | { users: number; sessions: number; views: number; avgSec: number; keyEvents: number; daily: { day: string; users: number }[]; pages: { path: string; views: number }[]; channels: { name: string; sessions: number }[] };
  search: null | { site: string; clicks: number; impressions: number; ctr: number; position: number; queries: { q: string; clicks: number; impressions: number }[] };
  warnings: string[];
};

async function ga4(property: string, days: number) {
  const id = property.replace(/^properties\//, '').trim();
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }];
  const j = await gpost(`https://analyticsdata.googleapis.com/v1beta/properties/${id}:batchRunReports`, {
    requests: [
      { dateRanges, metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }, { name: 'averageSessionDuration' }, { name: 'keyEvents' }] },
      { dateRanges, dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }], orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 400 },
      { dateRanges, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 6 },
      { dateRanges, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 6 },
    ],
  });
  const [tot, byDay, pages, ch] = j.reports ?? [];
  const t = tot?.rows?.[0]?.metricValues ?? [];
  const d8 = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return {
    users: nn(t[0]?.value), sessions: nn(t[1]?.value), views: nn(t[2]?.value), avgSec: nn(t[3]?.value), keyEvents: nn(t[4]?.value),
    daily: (byDay?.rows ?? []).map((r: any) => ({ day: d8(r.dimensionValues[0].value), users: nn(r.metricValues[0].value) })),
    pages: (pages?.rows ?? []).map((r: any) => ({ path: r.dimensionValues[0].value, views: nn(r.metricValues[0].value) })),
    channels: (ch?.rows ?? []).map((r: any) => ({ name: r.dimensionValues[0].value, sessions: nn(r.metricValues[0].value) })),
  };
}

async function gsc(siteUrl: string, explicit: boolean, days: number) {
  const until = isoDay(new Date(Date.now() - 3 * 864e5)); // Search Console data lags 2-3 days
  const since = isoDay(new Date(Date.now() - (days + 2) * 864e5));
  let host = '';
  try { host = new URL(siteUrl).hostname.replace(/^www\./, ''); } catch { /* explicit property string */ }
  const candidates = explicit ? [siteUrl] : [`sc-domain:${host}`, `https://${host}/`, `https://www.${host}/`];
  let last: any;
  for (const site of candidates) {
    try {
      const base = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
      const [tot, q] = await Promise.all([
        gpost(base, { startDate: since, endDate: until }),
        gpost(base, { startDate: since, endDate: until, dimensions: ['query'], rowLimit: 6 }),
      ]);
      const r = tot.rows?.[0] ?? {};
      return { site, clicks: nn(r.clicks), impressions: nn(r.impressions), ctr: nn(r.ctr), position: nn(r.position), queries: (q.rows ?? []).map((x: any) => ({ q: x.keys[0], clicks: nn(x.clicks), impressions: nn(x.impressions) })) };
    } catch (e) { last = e; }
  }
  throw last;
}

const cache = new Map<string, { at: number; data: SiteReport }>();

export async function siteReport(opts: { url?: string; ga?: string; gsc?: string; days: number }): Promise<SiteReport> {
  const key = JSON.stringify(opts);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.data;
  const warnings: string[] = [];
  const [ga, search] = await Promise.all([
    opts.ga ? ga4(opts.ga, opts.days).catch((e) => { warnings.push(`Analytics: ${e.message}`); return null; }) : null,
    opts.gsc || opts.url ? gsc(opts.gsc || opts.url!, !!opts.gsc, opts.days).catch((e) => { warnings.push(`Search Console: ${e.message}`); return null; }) : null,
  ]);
  const data = { ga, search, warnings };
  cache.set(key, { at: Date.now(), data });
  return data;
}
