import { env, has, HttpError } from './server.js';

// Meta (Facebook + Instagram) reach for one business: paid from the ad account, organic from the Page and its Instagram account.
// One server-side token (a System User token from the business's Business Manager is best: it does not expire).
// Needed permissions: ads_read, read_insights, pages_read_engagement, pages_show_list, instagram_basic, instagram_manage_insights.
export const metaReady = () => has('META_ACCESS_TOKEN') && (has('META_AD_ACCOUNT_ID') || has('META_PAGE_ID'));
export const metaMissing = () => ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID', 'META_PAGE_ID'].filter((k) => !has(k));

const V = () => env('META_GRAPH_VERSION') || 'v23.0';
const G = 'https://graph.facebook.com';

async function graph(path: string, params: Record<string, string> = {}, token = env('META_ACCESS_TOKEN')): Promise<any> {
  const q = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(`${G}/${V()}/${path}?${q}`, { signal: AbortSignal.timeout(15000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = new HttpError(r.status === 400 || r.status === 403 ? 424 : 502, j.error?.message || 'Meta API error');
    (e as any).code = j.error?.code;
    throw e;
  }
  return j;
}

export type Day = { day: string; paid?: number; fb?: number; ig?: number };
export type MetaReport = {
  configured: true;
  range: { since: string; until: string; days: number };
  paid: null | { reach: number; impressions: number; spend: number; clicks: number; ctr: number; cpm: number; frequency: number; results: number; currency: string; campaigns: { id: string; name: string; reach: number; impressions: number; spend: number; clicks: number }[] };
  facebook: null | { name: string; reach: number | null; views: number | null; engagements: number | null; followers: number | null };
  instagram: null | { username: string; reach: number | null; views: number | null; interactions: number | null; profileViews: number | null; followers: number | null };
  daily: Day[];
  warnings: string[];
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return isoDay(x); };
const unix = (d: string) => Math.floor(new Date(d + 'T00:00:00Z').getTime() / 1000);
const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/** Split [since, until] (inclusive days) into windows of at most `max` days. */
function windows(since: string, until: string, max: number) {
  const out: [string, string][] = [];
  for (let s = since; s <= until; s = addDays(s, max)) { const e = addDays(s, max - 1); out.push([s, e < until ? e : until]); }
  return out;
}

const RESULT_ACTIONS = ['lead', 'onsite_conversion.lead_grouped', 'onsite_conversion.messaging_conversation_started_7d', 'purchase', 'complete_registration', 'contact'];

async function paid(since: string, until: string, warnings: string[], daily: Map<string, Day>) {
  const raw = env('META_AD_ACCOUNT_ID');
  if (!raw) return null;
  const act = raw.startsWith('act_') ? raw : `act_${raw}`;
  const time_range = JSON.stringify({ since, until });
  const fields = 'reach,impressions,spend,clicks,ctr,cpm,frequency,actions';
  try {
    const [tot, byDay, byCamp, acct] = await Promise.all([
      graph(`${act}/insights`, { fields, time_range, level: 'account' }),
      graph(`${act}/insights`, { fields: 'reach', time_range, time_increment: '1', level: 'account', limit: '120' }),
      graph(`${act}/insights`, { fields: 'campaign_id,campaign_name,reach,impressions,spend,clicks', time_range, level: 'campaign', limit: '50', sort: 'reach_descending' }),
      graph(act, { fields: 'currency' }),
    ]);
    for (const r of byDay.data ?? []) { const d: Day = daily.get(r.date_start) ?? { day: r.date_start }; d.paid = n(r.reach); daily.set(r.date_start, d); }
    const t = tot.data?.[0] ?? {};
    const results = (t.actions ?? []).filter((a: any) => RESULT_ACTIONS.includes(a.action_type)).reduce((s: number, a: any) => s + n(a.value), 0);
    return {
      reach: n(t.reach), impressions: n(t.impressions), spend: n(t.spend), clicks: n(t.clicks), ctr: n(t.ctr), cpm: n(t.cpm), frequency: n(t.frequency), results,
      currency: acct.currency || 'ILS',
      campaigns: (byCamp.data ?? []).map((c: any) => ({ id: c.campaign_id, name: c.campaign_name, reach: n(c.reach), impressions: n(c.impressions), spend: n(c.spend), clicks: n(c.clicks) })).sort((a: any, b: any) => b.reach - a.reach).slice(0, 8),
    };
  } catch (e: any) { warnings.push(`ממומן: ${e.message}`); return null; }
}

/** Page insights: Meta renamed several Page metrics in 2025 (impressions → media views), so try the new name first, then the old one. */
async function pageMetric(pageId: string, token: string, names: string[], since: string, until: string): Promise<{ total: number; byDay: Map<string, number> } | null> {
  for (const metric of names) {
    try {
      const byDay = new Map<string, number>();
      for (const [s, e] of windows(since, until, 90)) {
        const j = await graph(`${pageId}/insights`, { metric, period: 'day', since: String(unix(s)), until: String(unix(addDays(e, 1))) }, token);
        // a daily value's end_time is the start of the next day
        for (const v of j.data?.[0]?.values ?? []) { const day = addDays(String(v.end_time).slice(0, 10), -1); if (day >= s && day <= e) byDay.set(day, n(v.value)); }
      }
      return { total: [...byDay.values()].reduce((a, b) => a + b, 0), byDay };
    } catch { /* try the next name */ }
  }
  return null;
}

async function igMetric(igId: string, metric: string, since: string, until: string): Promise<number | null> {
  try {
    let total = 0;
    for (const [s, e] of windows(since, until, 30)) {
      const j = await graph(`${igId}/insights`, { metric, period: 'day', metric_type: 'total_value', since: String(unix(s)), until: String(unix(addDays(e, 1))) });
      total += n(j.data?.[0]?.total_value?.value);
    }
    return total;
  } catch { return null; }
}

async function organic(since: string, until: string, warnings: string[], daily: Map<string, Day>) {
  const pageId = env('META_PAGE_ID');
  if (!pageId) return { facebook: null, instagram: null };
  let page: any;
  try { page = await graph(pageId, { fields: 'name,access_token,followers_count,fan_count,instagram_business_account{id,username,followers_count}' }); }
  catch (e: any) { warnings.push(`עמוד פייסבוק: ${e.message}`); return { facebook: null, instagram: null }; }
  const pt = page.access_token || env('META_ACCESS_TOKEN');

  const [reach, views, eng] = await Promise.all([
    pageMetric(pageId, pt, ['page_total_media_view_unique', 'page_impressions_unique'], since, until),
    pageMetric(pageId, pt, ['page_media_view', 'page_impressions'], since, until),
    pageMetric(pageId, pt, ['page_post_engagements'], since, until),
  ]);
  // daily reach is unique per day; summing days over-counts people seen on several days, so it is labelled as such in the UI
  for (const [day, v] of reach?.byDay ?? []) { const d: Day = daily.get(day) ?? { day }; d.fb = v; daily.set(day, d); }
  if (!reach && !views) warnings.push('עמוד פייסבוק: אין הרשאת read_insights לעמוד');
  const facebook = { name: page.name, reach: reach?.total ?? null, views: views?.total ?? null, engagements: eng?.total ?? null, followers: page.followers_count ?? page.fan_count ?? null };

  const ig = page.instagram_business_account || (env('META_IG_USER_ID') ? { id: env('META_IG_USER_ID') } : null);
  if (!ig) return { facebook, instagram: null };
  const igId = ig.id;
  // daily reach series
  try {
    for (const [s, e] of windows(since, until, 30)) {
      const j = await graph(`${igId}/insights`, { metric: 'reach', period: 'day', since: String(unix(s)), until: String(unix(addDays(e, 1))) });
      for (const v of j.data?.[0]?.values ?? []) { const day = addDays(String(v.end_time).slice(0, 10), -1); const d: Day = daily.get(day) ?? { day }; d.ig = n(v.value); daily.set(day, d); }
    }
  } catch (e: any) { warnings.push(`אינסטגרם: ${e.message}`); }
  const [igReach, igViews, igInter, igProfile] = await Promise.all([
    igMetric(igId, 'reach', since, until), igMetric(igId, 'views', since, until), igMetric(igId, 'total_interactions', since, until), igMetric(igId, 'profile_views', since, until),
  ]);
  return { facebook, instagram: { username: ig.username ?? '', reach: igReach, views: igViews, interactions: igInter, profileViews: igProfile, followers: ig.followers_count ?? null } };
}

const cache = new Map<number, { at: number; data: MetaReport }>();

export async function metaReport(days: number): Promise<MetaReport> {
  const hit = cache.get(days);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.data;
  const until = isoDay(new Date(Date.now() - 864e5)); // yesterday: today's numbers are still moving
  const since = addDays(until, -(days - 1));
  const warnings: string[] = [];
  const daily = new Map<string, Day>();
  const [p, o] = await Promise.all([paid(since, until, warnings, daily), organic(since, until, warnings, daily)]);
  const data: MetaReport = {
    configured: true, range: { since, until, days }, paid: p, facebook: o.facebook, instagram: o.instagram,
    daily: [...daily.values()].filter((d) => d.day >= since && d.day <= until).sort((a, b) => a.day.localeCompare(b.day)),
    warnings,
  };
  cache.set(days, { at: Date.now(), data });
  return data;
}
