import crypto, { createHmac } from 'node:crypto';
import { env, has, HttpError, israelDay, sbAdmin } from './server.js';

// Multi-account Meta Ads Campaign Manager & Daily AI Agent for Adigital (אדיג׳יטל).
// Uses META_ADS_ACCESS_TOKEN (or falls back to META_ACCESS_TOKEN) against Meta Graph API.

export interface AgencyAccountDef {
  accountId: string;
  name: string;
  business?: string;
  currency?: string;
  onlyIfSpending?: boolean;
  spendWindowDays?: number;
}

// Pre-configured with Avihu's selected client accounts under Adigital
export const DEFAULT_AGENCY_ACCOUNTS: AgencyAccountDef[] = [
  { accountId: '1976885606385451', name: 'ospa מודיעין - חשבון מודעות', business: 'O spa - ספא ראש', currency: 'ILS' },
  { accountId: '2082215055297480', name: 'מונה מדיקל 2023', business: 'Mona Medical', currency: 'ILS' },
  { accountId: '4074937399486924', name: 'TWOSOME טוסום', business: 'Twosome טוסום', currency: 'ILS' },
  { accountId: '1837296150474194', name: 'באלנס המכללה למנהל', business: 'רשת באלנס', currency: 'ILS' },
  { accountId: '821646469995550', name: 'באלנס בת ים', business: 'רשת באלנס', currency: 'ILS' },
  { accountId: '8939187936207591', name: 'באלנס רחובות - תקין', business: 'רשת באלנס', currency: 'ILS' },
  { accountId: '488768000725425', name: 'באלנס רמלה', business: 'רשת באלנס', currency: 'ILS' },
  { accountId: '2363596197375053', name: 'אורי ממריאים', business: 'StaRide', currency: 'ILS' },
  { accountId: '3252134508266879', name: 'איזי ריזולטס', business: 'Easy result - מודיעין', currency: 'ILS' },
  { accountId: '404832452020219', name: 'באלנס קורסים', business: 'רשת באלנס', currency: 'ILS' },
  { accountId: '1098191601648028', name: 'טכניקדמי', business: 'טכניקדמי', currency: 'ILS' },
  { accountId: '1311728263379591', name: 'עדן רוסק (Eden Rusak)', business: 'Eden rusak Social Media', currency: 'ILS' },
  { accountId: '840673895377579', name: 'ישי גורזאד (ג׳יקאר)', business: 'ג׳יקאר', currency: 'ILS' },
  { accountId: '1284434883648190', name: 'Cozy - עיסוי עד הבית', business: 'Cozy', currency: 'ILS' },
  { accountId: '1067443572879283', name: 'באלנס רמלה (Read-Only)', business: 'רשת באלנס', currency: 'USD', onlyIfSpending: true },
  { accountId: '1763642518048061', name: 'Gurzad - Kapso (Read-Only)', business: 'Gurzad', currency: 'USD', onlyIfSpending: true },
  { accountId: '1849260972705783', name: 'באלנס - הנהלת רשת (Read-Only)', business: 'רשת באלנס', currency: 'USD', onlyIfSpending: true },
  { accountId: '1778006913416905', name: 'באלנס מודיעין (Read-Only)', business: 'רשת באלנס', currency: 'USD', onlyIfSpending: true },
  { accountId: '1784991862926453', name: 'באלנס בת ים (Read-Only)', business: 'רשת באלנס', currency: 'USD', onlyIfSpending: true },
  { accountId: '1490080945278466', name: 'באלנס רשתי - חשבון חדש', business: 'רשת באלנס', currency: 'ILS', onlyIfSpending: true },
  { accountId: '1448864775131877', name: 'חשבון 1448864775131877', business: '', currency: 'ILS', onlyIfSpending: true, spendWindowDays: 3 },
  { accountId: '474070396666472', name: 'Ben Ron (474070396666472)', business: 'Ben Ron', currency: 'ILS', onlyIfSpending: true, spendWindowDays: 3 },
  { accountId: '488389281965091', name: 'חשבון 488389281965091', business: '', currency: 'ILS', onlyIfSpending: true, spendWindowDays: 3 },
];

export const metaAdsToken = () => env('META_ADS_ACCESS_TOKEN') || env('META_ACCESS_TOKEN');
export const metaCampaignsReady = () => Boolean(metaAdsToken());

const V = () => env('META_GRAPH_VERSION') || 'v22.0';
const G = 'https://graph.facebook.com';

async function graphReq(path: string, params: Record<string, string> = {}, method: 'GET' | 'POST' = 'GET'): Promise<any> {
  const token = metaAdsToken();
  if (!token) throw new HttpError(503, 'חסר טוקן גישה למטא (META_ADS_ACCESS_TOKEN)');
  const q = new URLSearchParams({ ...params, access_token: token });
  const secret = env('META_ADS_ACCESS_TOKEN') ? env('META_ADS_APP_SECRET') : env('META_APP_SECRET');
  if (secret) q.set('appsecret_proof', createHmac('sha256', secret).update(token).digest('hex'));

  const url = method === 'GET' ? `${G}/${V()}/${path.replace(/^\//, '')}?${q}` : `${G}/${V()}/${path.replace(/^\//, '')}`;
  const r = await fetch(url, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
    body: method === 'POST' ? q.toString() : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = new HttpError(r.status === 400 || r.status === 403 ? 424 : 502, j.error?.message || 'שגיאת Meta API');
    (e as any).code = j.error?.code;
    throw e;
  }
  return j;
}

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const shiftDays = (iso: string, delta: number) => {
  const x = new Date(iso + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + delta);
  return isoDate(x);
};

export function resolveRange(q: { days?: number; since?: string; until?: string }) {
  const today = israelDay();
  const defaultUntil = shiftDays(today, 0); // include today's live activity up to now
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (q.since && q.until && re.test(q.since) && re.test(q.until) && q.since <= q.until) {
    const diff = Math.max(1, Math.round((new Date(q.until).getTime() - new Date(q.since).getTime()) / 864e5) + 1);
    return { since: q.since, until: q.until, days: diff };
  }
  const days = [1, 3, 7, 14, 28, 30, 90].includes(Number(q.days)) ? Number(q.days) : 7;
  if (days === 1) {
    const y = shiftDays(today, -1);
    return { since: y, until: y, days: 1 };
  }
  const until = defaultUntil;
  const since = shiftDays(until, -(days - 1));
  return { since, until, days };
}

function pickAction(actions: any[] | undefined, types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  for (const t of types) {
    const hit = actions.find((a) => a?.action_type === t);
    if (hit && num(hit.value) > 0) return num(hit.value);
  }
  return 0;
}

function extractMetrics(row: any) {
  const actions = row?.actions as any[] | undefined;
  const spend = num(row?.spend);
  const impressions = num(row?.impressions);
  const reach = num(row?.reach);
  const clicks = num(row?.clicks);
  const ctr = num(row?.ctr);
  const cpm = num(row?.cpm);
  const frequency = num(row?.frequency);

  const leads = pickAction(actions, [
    'lead',
    'onsite_conversion.lead_grouped',
    'offsite_conversion.fb_pixel_lead',
    'onsite_web_lead',
  ]);
  const messages = pickAction(actions, [
    'onsite_conversion.messaging_conversation_started_7d',
    'onsite_conversion.total_messaging_connection',
  ]);
  const profileVisits = pickAction(actions, [
    'profile_visit_view',
    'ig_profile_visit',
    'onsite_conversion.view_profile',
  ]);
  const landingPageViews = pickAction(actions, ['landing_page_view', 'omni_landing_page_view']);
  const purchases = pickAction(actions, ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']);
  const linkClicks = pickAction(actions, ['link_click']);

  // Primary conversion count & label for CPL calculation
  let primaryResults = 0;
  let resultType = 'תוצאות';
  if (leads > 0 && leads >= messages) {
    primaryResults = leads;
    resultType = 'לידים';
  } else if (messages > 0) {
    primaryResults = messages;
    resultType = 'התכתבויות';
  } else if (purchases > 0) {
    primaryResults = purchases;
    resultType = 'רכישות';
  } else if (profileVisits > 0) {
    primaryResults = profileVisits;
    resultType = 'ביקורי פרופיל';
  }

  const costPerResult = primaryResults > 0 ? spend / primaryResults : null;

  return {
    spend,
    impressions,
    reach,
    clicks,
    linkClicks,
    ctr,
    cpm,
    frequency,
    leads,
    messages,
    profileVisits,
    landingPageViews,
    purchases,
    primaryResults,
    resultType,
    costPerResult,
  };
}

export interface AdItemSummary {
  id: string;
  name: string;
  campaignName?: string;
  adsetName?: string;
  status: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  frequency: number;
  leads: number;
  messages: number;
  profileVisits: number;
  primaryResults: number;
  resultType: string;
  costPerResult: number | null;
}

export interface AccountOverviewItem {
  accountId: string;
  name: string;
  business: string;
  currency: string;
  onlyIfSpending: boolean;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpm: number;
  frequency: number;
  leads: number;
  messages: number;
  profileVisits: number;
  landingPageViews: number;
  purchases: number;
  primaryResults: number;
  resultType: string;
  costPerResult: number | null;
  health: 'winner' | 'ok' | 'alert' | 'idle';
  statusLabel: string;
  winners: AdItemSummary[];
  bleeding: AdItemSummary[];
  error?: string;
}

export interface AgentRecommendation {
  id: string;
  accountId: string;
  accountName: string;
  kind: 'pause_ad' | 'scale_budget' | 'creative_refresh' | 'watch';
  priority: 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  impactIls: number;
  targetEntityId?: string;
  targetEntityName?: string;
  state?: 'pending' | 'approved' | 'skipped' | 'executed';
}

const overviewCache = new Map<string, { at: number; data: any }>();

async function fetchTopAdsForAccount(accountId: string, time_range: string): Promise<AdItemSummary[]> {
  const act = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const [ins, statuses] = await Promise.all([
    graphReq(`${act}/insights`, {
      level: 'ad',
      time_range,
      fields: 'ad_id,ad_name,campaign_name,adset_name,spend,impressions,reach,clicks,ctr,frequency,actions',
      sort: 'spend_descending',
      limit: '25',
    }),
    graphReq(`${act}/ads`, {
      fields: 'id,effective_status',
      limit: '100',
    }).catch(() => ({ data: [] })),
  ]);

  const statusMap = new Map<string, string>();
  for (const s of statuses.data ?? []) statusMap.set(String(s.id), String(s.effective_status || 'ACTIVE'));

  return (ins.data ?? []).map((row: any) => {
    const m = extractMetrics(row);
    const id = String(row.ad_id || '');
    return {
      id,
      name: String(row.ad_name || id),
      campaignName: row.campaign_name,
      adsetName: row.adset_name,
      status: statusMap.get(id) || 'ACTIVE',
      spend: m.spend,
      impressions: m.impressions,
      reach: m.reach,
      clicks: m.clicks,
      ctr: m.ctr,
      frequency: m.frequency,
      leads: m.leads,
      messages: m.messages,
      profileVisits: m.profileVisits,
      primaryResults: m.primaryResults,
      resultType: m.resultType,
      costPerResult: m.costPerResult,
    };
  });
}

function classifyAds(ads: AdItemSummary[], accountCpl: number | null) {
  const withResults = ads.filter((a) => a.primaryResults > 0 && a.costPerResult != null);
  const winners = [...withResults]
    .sort((a, b) => (a.costPerResult! - b.costPerResult!) || (b.primaryResults - a.primaryResults))
    .slice(0, 3);

  const avg = accountCpl && accountCpl > 0 ? accountCpl : 25;
  const bleeding = ads
    .filter((a) => {
      const isActive = a.status === 'ACTIVE';
      if (!isActive) return false;
      if (a.spend >= 55 && a.primaryResults === 0) return true;
      if (a.spend >= 80 && a.costPerResult != null && a.costPerResult > avg * 1.65) return true;
      return false;
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 3);

  return { winners, bleeding };
}

function buildRuleRecommendations(accounts: AccountOverviewItem[]): AgentRecommendation[] {
  const recs: AgentRecommendation[] = [];
  let seq = 1;

  for (const acc of accounts) {
    if (acc.spend <= 0) continue;
    for (const bad of acc.bleeding) {
      if (bad.primaryResults === 0 && bad.spend >= 55) {
        recs.push({
          id: `rec-${acc.accountId}-${bad.id}`,
          accountId: acc.accountId,
          accountName: acc.name,
          kind: 'pause_ad',
          priority: bad.spend >= 120 ? 'high' : 'medium',
          title: `עצירת מודעה ללא תוצאות · ${acc.name}`,
          reason: `המודעה "${bad.name}" הוציאה ₪${Math.round(bad.spend)} עם 0 תוצאות בתקופה שנבחרה.`,
          impactIls: Math.round(bad.spend),
          targetEntityId: bad.id,
          targetEntityName: bad.name,
          state: 'pending',
        });
      } else if (bad.costPerResult != null && acc.costPerResult != null) {
        recs.push({
          id: `rec-${acc.accountId}-${bad.id}`,
          accountId: acc.accountId,
          accountName: acc.name,
          kind: 'pause_ad',
          priority: bad.costPerResult > acc.costPerResult * 2 ? 'high' : 'medium',
          title: `עצירת מודעה יקרה · ${acc.name}`,
          reason: `"${bad.name}" בעלות ₪${bad.costPerResult.toFixed(1)} ל${bad.resultType.slice(0, -2) || 'תוצאה'} (ממוצע חשבון ₪${acc.costPerResult.toFixed(1)}).`,
          impactIls: Math.round(bad.spend * 0.65),
          targetEntityId: bad.id,
          targetEntityName: bad.name,
          state: 'pending',
        });
      }
    }

    if (acc.frequency >= 4.2 && acc.spend >= 300) {
      recs.push({
        id: `rec-freq-${acc.accountId}-${seq++}`,
        accountId: acc.accountId,
        accountName: acc.name,
        kind: 'creative_refresh',
        priority: acc.frequency >= 5.2 ? 'high' : 'medium',
        title: `רענון קריאייטיב דחוף · ${acc.name}`,
        reason: `תדירות החשיפה הגיעה ל-${acc.frequency.toFixed(2)} (מעל טווח היעד 1.0–3.0) וגורמת לשחיקת קהל.`,
        impactIls: Math.round(acc.spend * 0.2),
        state: 'pending',
      });
    } else if (acc.health === 'winner' && acc.frequency <= 2.2 && acc.primaryResults >= 20) {
      recs.push({
        id: `rec-scale-${acc.accountId}-${seq++}`,
        accountId: acc.accountId,
        accountName: acc.name,
        kind: 'scale_budget',
        priority: 'medium',
        title: `הגדלת תקציב +20% · ${acc.name}`,
        reason: `${acc.primaryResults} ${acc.resultType} בעלות יציבה (₪${(acc.costPerResult ?? 0).toFixed(1)}) ותדירות נמוכה (${acc.frequency.toFixed(2)}).`,
        impactIls: Math.round(acc.spend * 0.2),
        state: 'pending',
      });
    }
  }

  return recs.sort((a, b) => (a.priority === 'high' ? -1 : 1) - (b.priority === 'high' ? -1 : 1) || b.impactIls - a.impactIls).slice(0, 10);
}

export async function loadAgencyAccounts(workspaceId: string): Promise<AgencyAccountDef[]> {
  try {
    const { data } = await sbAdmin()
      .from('gd_records')
      .select('data')
      .eq('workspace_id', workspaceId)
      .eq('collection', 'meta_ad_accounts')
      .limit(200);
    if (data && data.length > 0) {
      return data.map((r: any) => r.data as AgencyAccountDef).filter((a) => a.accountId);
    }
  } catch { /* fallback to default list */ }
  return DEFAULT_AGENCY_ACCOUNTS;
}

export async function campaignsOverview(
  workspaceId: string,
  opts: { days?: number; since?: string; until?: string; force?: boolean } = {},
) {
  if (!metaCampaignsReady()) {
    return { configured: false, missing: ['META_ADS_ACCESS_TOKEN'] };
  }

  const range = resolveRange(opts);
  const cacheKey = `${workspaceId}:${range.since}:${range.until}`;
  const hit = overviewCache.get(cacheKey);
  if (!opts.force && hit && Date.now() - hit.at < 5 * 60e3) return hit.data;

  const list = await loadAgencyAccounts(workspaceId);
  const time_range = JSON.stringify({ since: range.since, until: range.until });
  const fields = 'account_id,account_name,spend,impressions,reach,clicks,ctr,cpm,frequency,actions';

  // Fetch account-level insights in parallel chunks of 8
  const rawResults: AccountOverviewItem[] = [];
  for (let i = 0; i < list.length; i += 8) {
    const chunk = list.slice(i, i + 8);
    const chunkOut = await Promise.all(
      chunk.map(async (def): Promise<AccountOverviewItem> => {
        const act = def.accountId.startsWith('act_') ? def.accountId : `act_${def.accountId}`;
        try {
          const j = await graphReq(`${act}/insights`, { fields, time_range, level: 'account' });
          const row = j.data?.[0] ?? {};
          const m = extractMetrics(row);
          let health: AccountOverviewItem['health'] = 'ok';
          let statusLabel = 'תקין';
          if (m.spend <= 0) {
            health = 'idle';
            statusLabel = 'ללא הוצאה';
          } else if (m.frequency >= 4.2) {
            health = 'alert';
            statusLabel = `שחיקה (${m.frequency.toFixed(1)})`;
          } else if (m.primaryResults >= 15 && m.frequency <= 2.6) {
            health = 'winner';
            statusLabel = 'מנצח ויציב';
          }
          return {
            accountId: def.accountId,
            name: def.name || row.account_name || def.accountId,
            business: def.business || '',
            currency: def.currency || 'ILS',
            onlyIfSpending: Boolean(def.onlyIfSpending),
            ...m,
            health,
            statusLabel,
            winners: [],
            bleeding: [],
          };
        } catch (e: any) {
          return {
            accountId: def.accountId,
            name: def.name,
            business: def.business || '',
            currency: def.currency || 'ILS',
            onlyIfSpending: Boolean(def.onlyIfSpending),
            spend: 0,
            impressions: 0,
            reach: 0,
            clicks: 0,
            ctr: 0,
            cpm: 0,
            frequency: 0,
            leads: 0,
            messages: 0,
            profileVisits: 0,
            landingPageViews: 0,
            purchases: 0,
            primaryResults: 0,
            resultType: 'תוצאות',
            costPerResult: null,
            health: 'idle',
            statusLabel: 'לא זמין',
            winners: [],
            bleeding: [],
            error: e.message,
          };
        }
      }),
    );
    rawResults.push(...chunkOut);
  }

  // Enrich top 10 spending accounts with ad-level winners & bleeding ads
  const activeSorted = rawResults.filter((a) => a.spend > 0).sort((a, b) => b.spend - a.spend);
  const topToEnrich = activeSorted.slice(0, 10);
  await Promise.all(
    topToEnrich.map(async (acc) => {
      try {
        const ads = await fetchTopAdsForAccount(acc.accountId, time_range);
        const { winners, bleeding } = classifyAds(ads, acc.costPerResult);
        acc.winners = winners;
        acc.bleeding = bleeding;
        if (bleeding.length > 0 && acc.health !== 'alert') {
          acc.health = 'alert';
          acc.statusLabel = `${bleeding.length} מודעות יקרות`;
        }
      } catch { /* keep account summary even if ad-level call times out */ }
    }),
  );

  // Filter out conditional zero-spend accounts from main active view, keep count
  const visibleAccounts = rawResults
    .filter((a) => !a.onlyIfSpending || a.spend > 0)
    .sort((a, b) => b.spend - a.spend);
  const skippedConditionalCount = rawResults.length - visibleAccounts.length;

  // Load saved AI Agent review / recommendation states from Supabase if present
  let savedReview: any = null;
  let stateOverrides: Record<string, string> = {};
  try {
    const sb = sbAdmin();
    const [{ data: revRows }, { data: stateRows }] = await Promise.all([
      sb.from('gd_records').select('id, data').eq('workspace_id', workspaceId).eq('collection', 'meta_agent_reviews').limit(20),
      sb.from('gd_records').select('id, data').eq('workspace_id', workspaceId).eq('collection', 'meta_rec_states').limit(200),
    ]);
    if (revRows?.length) {
      const sorted = revRows.map((r: any) => ({ id: r.id, ...(r.data as any) })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      savedReview = sorted[0];
    }
    for (const r of stateRows ?? []) {
      const d = r.data as any;
      if (d?.recId && d?.state) stateOverrides[d.recId] = d.state;
    }
  } catch { /* ignore if Supabase unavailable */ }

  const ruleRecs = buildRuleRecommendations(visibleAccounts);
  const mergedRecs: AgentRecommendation[] = (savedReview?.recommendations?.length ? savedReview.recommendations : ruleRecs).map(
    (r: AgentRecommendation) => ({
      ...r,
      state: (stateOverrides[r.id] as any) || r.state || 'pending',
    }),
  );

  const totals = visibleAccounts.reduce(
    (acc, x) => {
      if (x.currency === 'ILS' || x.spend > 0) {
        acc.spend += x.spend;
        acc.impressions += x.impressions;
        acc.reach += x.reach;
        acc.clicks += x.clicks;
        acc.leads += x.leads;
        acc.messages += x.messages;
        acc.profileVisits += x.profileVisits;
        acc.purchases += x.purchases;
        if (x.spend > 0) acc.activeCount += 1;
        if (x.health === 'alert') acc.alertCount += 1;
        if (x.health === 'winner') acc.winnerCount += 1;
      }
      return acc;
    },
    { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, messages: 0, profileVisits: 0, purchases: 0, activeCount: 0, alertCount: 0, winnerCount: 0 },
  );

  const payload = {
    configured: true,
    range,
    totals,
    accounts: visibleAccounts,
    skippedConditionalCount,
    recommendations: mergedRecs,
    agentSummary: savedReview?.summary || null,
    agentLastRunAt: savedReview?.createdAt || null,
  };

  overviewCache.set(cacheKey, { at: Date.now(), data: payload });
  return payload;
}

export async function campaignsAccountDetail(
  accountId: string,
  opts: { days?: number; since?: string; until?: string } = {},
) {
  if (!metaCampaignsReady()) throw new HttpError(503, 'META_ADS_ACCESS_TOKEN לא מוגדר');
  const range = resolveRange(opts);
  const act = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const time_range = JSON.stringify({ since: range.since, until: range.until });
  const fields = 'spend,impressions,reach,clicks,ctr,cpm,frequency,actions';

  const [acctInfo, totRes, dailyRes, campRes, adsList] = await Promise.all([
    graphReq(act, { fields: 'name,currency,account_status' }).catch(() => ({ name: accountId, currency: 'ILS' })),
    graphReq(`${act}/insights`, { level: 'account', time_range, fields }),
    graphReq(`${act}/insights`, { level: 'account', time_range, time_increment: '1', fields, limit: '120' }),
    graphReq(`${act}/insights`, {
      level: 'campaign',
      time_range,
      fields: 'campaign_id,campaign_name,spend,impressions,reach,clicks,ctr,frequency,actions',
      sort: 'spend_descending',
      limit: '30',
    }),
    fetchTopAdsForAccount(accountId, time_range),
  ]);

  const summary = extractMetrics(totRes.data?.[0] ?? {});

  // Fill every calendar day in [since, until] so the daily chart & table have zero gaps
  const byDayMap = new Map<string, ReturnType<typeof extractMetrics> & { day: string }>();
  for (let d = range.since; d <= range.until; d = shiftDays(d, 1)) {
    byDayMap.set(d, { day: d, ...extractMetrics({}) });
  }
  for (const r of dailyRes.data ?? []) {
    const day = String(r.date_start || '');
    if (day) byDayMap.set(day, { day, ...extractMetrics(r) });
  }
  const daily = [...byDayMap.values()].sort((a, b) => a.day.localeCompare(b.day));

  const campaigns = (campRes.data ?? []).map((c: any) => ({
    id: String(c.campaign_id),
    name: String(c.campaign_name || ''),
    ...extractMetrics(c),
  }));

  const { winners, bleeding } = classifyAds(adsList, summary.costPerResult);

  return {
    accountId: accountId.replace(/^act_/, ''),
    name: DEFAULT_AGENCY_ACCOUNTS.find((a) => a.accountId === accountId.replace(/^act_/, ''))?.name || acctInfo.name || accountId,
    currency: acctInfo.currency || 'ILS',
    range,
    summary,
    daily,
    campaigns,
    ads: adsList,
    winners,
    bleeding,
  };
}

const AGENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING', description: 'סיכום מנהלים חד וקצר בעברית (2-3 משפטים) של תמונת המצב היום' },
    recommendations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          accountId: { type: 'STRING' },
          accountName: { type: 'STRING' },
          kind: { type: 'STRING', enum: ['pause_ad', 'scale_budget', 'creative_refresh', 'watch'] },
          priority: { type: 'STRING', enum: ['high', 'medium', 'low'] },
          title: { type: 'STRING' },
          reason: { type: 'STRING' },
          impactIls: { type: 'NUMBER' },
          targetEntityId: { type: 'STRING', nullable: true },
          targetEntityName: { type: 'STRING', nullable: true },
        },
        required: ['id', 'accountId', 'accountName', 'kind', 'priority', 'title', 'reason', 'impactIls'],
      },
    },
  },
  required: ['summary', 'recommendations'],
};

async function callGeminiJson(body: unknown) {
  const models = [env('GEMINI_MODEL') || 'gemini-3.8-flash', 'gemini-flash-latest'].filter((m, i, a) => a.indexOf(m) === i);
  let lastErr = '';
  for (const model of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (r.ok) return r.json() as Promise<any>;
    lastErr = `Gemini ${model} (${r.status}): ${(await r.text()).slice(0, 160)}`;
    if (![404, 429, 500, 503].includes(r.status)) break;
  }
  throw new HttpError(502, lastErr || 'שגיאת Gemini');
}

export async function runMetaDailyAgent(workspaceId: string, days = 7) {
  const overview = await campaignsOverview(workspaceId, { days, force: true });
  if (!overview.configured) throw new HttpError(503, 'META_ADS_ACCESS_TOKEN לא מוגדר');

  const compactInput = overview.accounts
    .filter((a: AccountOverviewItem) => a.spend > 0)
    .map((a: AccountOverviewItem) => ({
      accountId: a.accountId,
      name: a.name,
      spend: Math.round(a.spend),
      leads: a.leads,
      messages: a.messages,
      profileVisits: a.profileVisits,
      ctr: Number(a.ctr.toFixed(2)),
      frequency: Number(a.frequency.toFixed(2)),
      costPerResult: a.costPerResult ? Number(a.costPerResult.toFixed(1)) : null,
      winners: a.winners.map((w) => ({ id: w.id, name: w.name, spend: Math.round(w.spend), results: w.primaryResults, cpl: w.costPerResult ? Number(w.costPerResult.toFixed(1)) : null })),
      bleeding: a.bleeding.map((b) => ({ id: b.id, name: b.name, spend: Math.round(b.spend), results: b.primaryResults, cpl: b.costPerResult ? Number(b.costPerResult.toFixed(1)) : null })),
    }));

  let summary = `נסרקו ${compactInput.length} חשבונות פעילים ב-${days} הימים האחרונים (סה״כ הוצאה ₪${Math.round(overview.totals.spend).toLocaleString('he-IL')}). זוהו ${overview.recommendations.length} הזדמנויות אופטימיזציה ממוקדות.`;
  let recommendations: AgentRecommendation[] = buildRuleRecommendations(overview.accounts);

  if (has('GEMINI_API_KEY')) {
    try {
      const prompt = `אתה מנהל מדיה בכיר בסוכנות הפרסום אדיג׳יטל (Adigital). נתח את נתוני הקמפיינים החיים מ-Meta Ads ב-${days} הימים האחרונים והפק סיכום מנהלים קצר + עד 8 המלצות פעולה ממוקדות בעברית (עצירת מודעות שורפות עם targetEntityId מדויק מהנתונים, העלאת תקציב לחשבונות מנצחים עם תדירות נמוכה, ורענון קריאייטיב לחשבונות עם תדירות מעל 4). אל תמציא מספרים או מזהים שלא מופיעים בקלט.\n\nנתונים:\n${JSON.stringify(compactInput)}`;
      const j: any = await callGeminiJson({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: AGENT_SCHEMA },
      });
      const parsed = JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}');
      if (parsed.summary) summary = parsed.summary;
      if (Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
        recommendations = parsed.recommendations.map((rec: AgentRecommendation) => ({ ...rec, state: 'pending' }));
      }
    } catch (e) {
      console.warn('Gemini Meta agent fallback to deterministic rules:', e);
    }
  }

  const record = {
    date: israelDay(),
    createdAt: new Date().toISOString(),
    days,
    summary,
    recommendations,
  };

  try {
    await sbAdmin().from('gd_records').insert({
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      collection: 'meta_agent_reviews',
      data: record,
    });
    overviewCache.clear();
  } catch (e) {
    console.warn('Could not persist meta_agent_reviews:', e);
  }

  return record;
}

export async function updateRecommendationState(workspaceId: string, recId: string, state: 'pending' | 'approved' | 'skipped' | 'executed') {
  const sb = sbAdmin();
  const { data: existing } = await sb
    .from('gd_records')
    .select('id, data')
    .eq('workspace_id', workspaceId)
    .eq('collection', 'meta_rec_states')
    .limit(300);
  const hit = (existing ?? []).find((r: any) => (r.data as any)?.recId === recId);
  if (hit) {
    await sb.from('gd_records').update({ data: { ...(hit.data as object), recId, state, updatedAt: new Date().toISOString() } }).eq('id', hit.id);
  } else {
    await sb.from('gd_records').insert({
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      collection: 'meta_rec_states',
      data: { recId, state, updatedAt: new Date().toISOString() },
    });
  }
  overviewCache.clear();
  return { ok: true, recId, state };
}

export async function setMetaEntityStatus(
  workspaceId: string,
  opts: { entityId: string; status: 'PAUSED' | 'ACTIVE'; accountId?: string; accountName?: string; entityName?: string; recId?: string },
) {
  if (!/^\d+$/.test(opts.entityId)) throw new HttpError(400, 'מזהה מודעה/קמפיין לא תקין');
  await graphReq(opts.entityId, { status: opts.status }, 'POST');
  overviewCache.clear();

  try {
    await sbAdmin().from('gd_records').insert({
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      collection: 'meta_agent_logs',
      data: {
        at: new Date().toISOString(),
        entityId: opts.entityId,
        entityName: opts.entityName || '',
        accountId: opts.accountId || '',
        accountName: opts.accountName || '',
        status: opts.status,
      },
    });
    if (opts.recId) await updateRecommendationState(workspaceId, opts.recId, 'executed');
  } catch { /* non-fatal */ }

  return { ok: true, entityId: opts.entityId, status: opts.status };
}


/* ================= Verified Execution, Budget Scaling & Live Agent Chat ================= */

export interface VerifiedActionLog {
  id?: string;
  at: string;
  accountId: string;
  accountName: string;
  entityId: string;
  entityName: string;
  actionType: 'status_change' | 'budget_change';
  beforeValue: string;
  afterValue: string;
  verifiedOnMeta: boolean;
  metaUpdatedTime?: string;
}

/** Verify an entity's current live state directly from Meta Graph API. */
export async function verifyMetaEntityLive(entityId: string) {
  if (!/^\d+$/.test(entityId)) throw new HttpError(400, 'מזהה ישות לא תקין');
  const info = await graphReq(entityId, { fields: 'id,name,status,effective_status,daily_budget,updated_time' });
  return {
    id: String(info.id || entityId),
    name: String(info.name || entityId),
    status: String(info.status || ''),
    effectiveStatus: String(info.effective_status || ''),
    dailyBudget: info.daily_budget != null ? Number(info.daily_budget) / 100 : null,
    updatedTime: info.updated_time || null,
  };
}

/** Execute a recommendation (pause ad OR scale budget) and verify the change via read-back from Meta. */
export async function executeVerifiedRecommendation(
  workspaceId: string,
  opts: {
    recId?: string;
    kind: 'pause_ad' | 'activate_ad' | 'scale_budget';
    accountId: string;
    accountName: string;
    targetEntityId?: string;
    targetEntityName?: string;
    deltaPct?: number;
  },
): Promise<{ ok: true; receipt: VerifiedActionLog }> {
  if (opts.kind === 'pause_ad' || opts.kind === 'activate_ad') {
    const entityId = String(opts.targetEntityId || '');
    if (!/^\d+$/.test(entityId)) throw new HttpError(400, 'חסר מזהה מודעה לביצוע במטא');
    const desired = opts.kind === 'activate_ad' ? 'ACTIVE' : 'PAUSED';

    const before = await verifyMetaEntityLive(entityId);
    await graphReq(entityId, { status: desired }, 'POST');
    const after = await verifyMetaEntityLive(entityId);
    overviewCache.clear();

    const receipt: VerifiedActionLog = {
      at: new Date().toISOString(),
      accountId: opts.accountId,
      accountName: opts.accountName,
      entityId,
      entityName: after.name || opts.targetEntityName || entityId,
      actionType: 'status_change',
      beforeValue: before.status || before.effectiveStatus || 'UNKNOWN',
      afterValue: after.status || after.effectiveStatus || desired,
      verifiedOnMeta: after.status === desired || after.effectiveStatus === desired,
      metaUpdatedTime: after.updatedTime || undefined,
    };

    try {
      await sbAdmin().from('gd_records').insert({
        id: crypto.randomUUID(),
        workspace_id: workspaceId,
        collection: 'meta_agent_logs',
        data: receipt,
      });
      if (opts.recId) await updateRecommendationState(workspaceId, opts.recId, 'executed');
    } catch { /* non-fatal */ }

    return { ok: true, receipt };
  }

  // Budget scaling (+20% default, hard guardrail -50%..+30%)
  const pct = Math.max(-50, Math.min(30, Number(opts.deltaPct ?? 20)));
  const act = opts.accountId.startsWith('act_') ? opts.accountId : `act_${opts.accountId}`;
  let targetId = opts.targetEntityId && /^\d+$/.test(opts.targetEntityId) ? opts.targetEntityId : '';
  let targetName = opts.targetEntityName || '';
  let currentCents = 0;

  if (targetId) {
    const info = await graphReq(targetId, { fields: 'id,name,daily_budget,status' });
    if (info.daily_budget) {
      currentCents = Number(info.daily_budget);
      targetName = info.name || targetName;
    }
  }

  if (!currentCents) {
    // Discover active campaign or adset that holds daily_budget in this account
    const [camps, adsets] = await Promise.all([
      graphReq(`${act}/campaigns`, { fields: 'id,name,effective_status,daily_budget', limit: '25' }).catch(() => ({ data: [] })),
      graphReq(`${act}/adsets`, { fields: 'id,name,effective_status,daily_budget', limit: '25' }).catch(() => ({ data: [] })),
    ]);
    const activeBudgetHolder =
      (camps.data ?? []).find((c: any) => c.effective_status === 'ACTIVE' && Number(c.daily_budget) > 0) ||
      (adsets.data ?? []).find((a: any) => a.effective_status === 'ACTIVE' && Number(a.daily_budget) > 0);
    if (!activeBudgetHolder) {
      throw new HttpError(422, 'לא נמצא קמפיין או סט מודעות פעיל עם תקציב יומי מוגדר בחשבון זה');
    }
    targetId = String(activeBudgetHolder.id);
    targetName = String(activeBudgetHolder.name || targetId);
    currentCents = Number(activeBudgetHolder.daily_budget);
  }

  const nextCents = Math.max(500, Math.round(currentCents * (1 + pct / 100)));
  await graphReq(targetId, { daily_budget: String(nextCents) }, 'POST');
  const after = await verifyMetaEntityLive(targetId);
  overviewCache.clear();

  const receipt: VerifiedActionLog = {
    at: new Date().toISOString(),
    accountId: opts.accountId,
    accountName: opts.accountName,
    entityId: targetId,
    entityName: after.name || targetName,
    actionType: 'budget_change',
    beforeValue: `₪${(currentCents / 100).toFixed(0)}/יום`,
    afterValue: after.dailyBudget != null ? `₪${after.dailyBudget.toFixed(0)}/יום` : `₪${(nextCents / 100).toFixed(0)}/יום`,
    verifiedOnMeta: after.dailyBudget != null && Math.abs(after.dailyBudget * 100 - nextCents) <= 5,
    metaUpdatedTime: after.updatedTime || undefined,
  };

  try {
    await sbAdmin().from('gd_records').insert({
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      collection: 'meta_agent_logs',
      data: receipt,
    });
    if (opts.recId) await updateRecommendationState(workspaceId, opts.recId, 'executed');
  } catch { /* non-fatal */ }

  return { ok: true, receipt };
}

export async function listVerifiedActionLogs(workspaceId: string): Promise<VerifiedActionLog[]> {
  try {
    const { data } = await sbAdmin()
      .from('gd_records')
      .select('id, data')
      .eq('workspace_id', workspaceId)
      .eq('collection', 'meta_agent_logs')
      .limit(50);
    return (data ?? [])
      .map((r: any) => ({ id: r.id, ...(r.data as VerifiedActionLog) }))
      .filter((x) => x.entityId)
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, 20);
  } catch {
    return [];
  }
}

const CHAT_TOOLS = [
  {
    name: 'inspect_account_details',
    description: 'שליפת נתונים חיים מ-Meta Ads ללקוח ספציפי (סיכום, פירוט יומי ומודעות פעילות)',
    parameters: {
      type: 'OBJECT',
      properties: {
        accountId: { type: 'STRING', description: 'מזהה חשבון המודעות המספרי' },
        days: { type: 'NUMBER', description: 'מספר ימים אחורה (למשל 7, 14, 30)' },
      },
      required: ['accountId'],
    },
  },
  {
    name: 'change_ad_status',
    description: 'השהיה (PAUSED) או הפעלה (ACTIVE) של מודעה או קמפיין ב-Meta Ads עם אימות חי מול השרת',
    parameters: {
      type: 'OBJECT',
      properties: {
        accountId: { type: 'STRING' },
        accountName: { type: 'STRING' },
        entityId: { type: 'STRING', description: 'מזהה המודעה/קמפיין המספרי במטא' },
        entityName: { type: 'STRING' },
        status: { type: 'STRING', enum: ['PAUSED', 'ACTIVE'] },
      },
      required: ['accountId', 'accountName', 'entityId', 'status'],
    },
  },
  {
    name: 'adjust_account_budget',
    description: 'שינוי תקציב יומי באחוזים (למשל +20 או -15, בטווח -50 עד +30) עם אימות חי מול Meta Ads',
    parameters: {
      type: 'OBJECT',
      properties: {
        accountId: { type: 'STRING' },
        accountName: { type: 'STRING' },
        targetEntityId: { type: 'STRING', description: 'מזהה קמפיין או סט מודעות (אופציונלי — אם ריק ייבחר הפעיל המוביל)' },
        deltaPct: { type: 'NUMBER', description: 'אחוז שינוי תקציב בין -50 ל-30' },
      },
      required: ['accountId', 'accountName', 'deltaPct'],
    },
  },
];

export async function metaAgentLiveChat(
  workspaceId: string,
  message: string,
  history: Array<{ role: 'user' | 'model'; text: string }> = [],
  canMutate = false,
): Promise<{ reply: string; executedReceipts: VerifiedActionLog[] }> {
  if (!has('GEMINI_API_KEY')) {
    throw new HttpError(503, 'חסר GEMINI_API_KEY בשרת כדי לנהל שיחה חיה עם הסוכן');
  }
  const overview = await campaignsOverview(workspaceId, { days: 7 });
  const executedReceipts: VerifiedActionLog[] = [];

  const sysPrompt = `אתה סוכן ניהול הקמפיינים החי של סוכנות הפרסום אדיג׳יטל (Adigital).
ענה תמיד בעברית ברורה, קצרה ומקצועית.
יש לך גישה חיה לנתוני Meta Ads של כל לקוחות המשרד ואפשרות לבצע פעולות אמיתיות במטא (השהיית/הפעלת מודעות ושינוי תקציב יומי עד +30%) רק כשהמשתמש מבקש זאת במפורש.
אחרי כל פעולה שאתה מבצע דרך הכלי, דווח למשתמש את הערך לפני -> אחרי כפי שאומת מול שרתי Meta.
אל תמציא נתונים או מזהים לעולם.

תמונת מצב נוכחית (7 ימים אחרונים):
${JSON.stringify(
  (overview.accounts || []).slice(0, 16).map((a: AccountOverviewItem) => ({
    accountId: a.accountId,
    name: a.name,
    spend: Math.round(a.spend),
    leads: a.leads,
    messages: a.messages,
    impressions: a.impressions,
    profileVisits: a.profileVisits,
    frequency: Number(a.frequency.toFixed(2)),
    cpl: a.costPerResult ? Number(a.costPerResult.toFixed(1)) : null,
    winners: a.winners.map((w) => ({ id: w.id, name: w.name, cpl: w.costPerResult })),
    bleeding: a.bleeding.map((b) => ({ id: b.id, name: b.name, spend: b.spend, cpl: b.costPerResult })),
  })),
)}`;

  const contents: any[] = [
    ...history.filter((h) => h.text).slice(-10).map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: message }] },
  ];
  while (contents.length > 1 && contents[0].role !== 'user') contents.shift();

  for (let round = 0; round < 4; round++) {
    const out: any = await callGeminiJson({
      systemInstruction: { parts: [{ text: sysPrompt }] },
      tools: [{ functionDeclarations: CHAT_TOOLS }],
      contents,
    });
    const parts: any[] = out.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const reply = parts.map((p) => p.text || '').join('').trim() || 'בוצע.';
      return { reply, executedReceipts };
    }
    contents.push({ role: 'model', parts });
    const responses = [];
    for (const c of calls) {
      const fn = c.functionCall.name;
      const args = c.functionCall.args ?? {};
      let toolRes: unknown;
      try {
        if (fn === 'inspect_account_details') {
          toolRes = await campaignsAccountDetail(String(args.accountId), { days: Number(args.days) || 7 });
        } else if (fn === 'change_ad_status') {
          if (!canMutate) throw new Error('רק בעל המערכת רשאי לבצע שינויים במטא');
          const res = await executeVerifiedRecommendation(workspaceId, {
            kind: args.status === 'ACTIVE' ? 'activate_ad' : 'pause_ad',
            accountId: String(args.accountId),
            accountName: String(args.accountName),
            targetEntityId: String(args.entityId),
            targetEntityName: args.entityName ? String(args.entityName) : undefined,
          });
          executedReceipts.push(res.receipt);
          toolRes = res.receipt;
        } else if (fn === 'adjust_account_budget') {
          if (!canMutate) throw new Error('רק בעל המערכת רשאי לשנות תקציבים במטא');
          const res = await executeVerifiedRecommendation(workspaceId, {
            kind: 'scale_budget',
            accountId: String(args.accountId),
            accountName: String(args.accountName),
            targetEntityId: args.targetEntityId ? String(args.targetEntityId) : undefined,
            deltaPct: Number(args.deltaPct),
          });
          executedReceipts.push(res.receipt);
          toolRes = res.receipt;
        } else {
          toolRes = { error: 'כלי לא מוכר' };
        }
      } catch (e: any) {
        toolRes = { error: e.message || 'שגיאה בביצוע הפעולה' };
      }
      responses.push({ functionResponse: { name: fn, response: { result: toolRes } } });
    }
    contents.push({ role: 'user', parts: responses });
  }

  return { reply: 'הפעולות בוצעו ואומתו מול Meta.', executedReceipts };
}
