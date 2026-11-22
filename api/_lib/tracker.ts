import { sbAdmin } from './server.js';
import type { SiteConversion } from '../t.js';

type EventRow = {
  id: string;
  site_id: string;
  kind: 'pageview' | 'conversion';
  visitor_id: string;
  session_id: string;
  is_new: boolean;
  path: string;
  title: string | null;
  referrer: string | null;
  device: 'mobile' | 'desktop' | 'tablet' | null;
  browser: string | null;
  country: string | null;
  duration_sec: number;
  conversion_id: string | null;
  conversion_name: string | null;
  conversion_value: number | null;
  from_ads: boolean;
  google_sent: boolean;
  gclid: string | null;
  created_at: string;
  last_seen_at: string;
};

type SiteRecord = {
  id: string;
  name: string;
  domain: string;
  url: string;
  owner?: string;
  site_key?: string;
  ga_property?: string;
  gsc_site?: string;
  shared?: boolean;
  conversions: SiteConversion[];
};

const TZ = 'Asia/Jerusalem';
const fmtDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtHour = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false });
const fmtDow = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const DOW_IDX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function ilDay(d: Date): string {
  return fmtDay.format(d);
}
function ilHour(d: Date): number {
  const h = Number(fmtHour.format(d));
  return h === 24 ? 0 : h;
}
function ilDow(d: Date): number {
  return DOW_IDX[fmtDow.format(d)] ?? 0;
}

function cleanDomain(raw?: string): string {
  if (!raw) return '';
  let s = raw.trim().toLowerCase();
  try {
    if (s.includes('://')) s = new URL(s).hostname;
  } catch { /* ignore */ }
  return s.replace(/^www\./, '').replace(/\/.*$/, '');
}

function pctDelta(cur: number, prev: number): number | null {
  if (prev === 0) return cur > 0 ? null : 0;
  return (cur - prev) / prev;
}

function dayList(days: number, endDate: Date): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(ilDay(new Date(endDate.getTime() - i * 864e5)));
  }
  return out;
}

function isMonitorSite(data: Record<string, any>): boolean {
  if (data.kind !== 'אתר') return false;
  const u = String(data.url || '');
  if (/vercel\.app|localhost|127\.0\.0\.1/.test(u) && !data.site_key) return false;
  return true;
}

function toSiteRecord(row: { id: string; data: any }): SiteRecord {
  const d = row.data || {};
  return {
    id: row.id,
    name: String(d.name || 'אתר'),
    domain: cleanDomain(d.domain || d.url),
    url: String(d.url || (d.domain ? `https://${cleanDomain(d.domain)}` : '')),
    owner: d.owner,
    site_key: d.site_key,
    ga_property: d.ga_property,
    gsc_site: d.gsc_site,
    shared: !!d.shared,
    conversions: Array.isArray(d.conversions) ? d.conversions : [],
  };
}

async function fetchEvents(workspaceId: string, sinceIso: string, siteId?: string): Promise<{ rows: EventRow[]; missingTable: boolean }> {
  const sb = sbAdmin();
  const out: EventRow[] = [];
  for (let from = 0; from < 25000; from += 1000) {
    let q = sb
      .from('gd_site_events')
      .select('id, site_id, kind, visitor_id, session_id, is_new, path, title, referrer, device, browser, country, duration_sec, conversion_id, conversion_name, conversion_value, from_ads, google_sent, gclid, created_at, last_seen_at')
      .eq('workspace_id', workspaceId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .range(from, from + 999);
    if (siteId) q = q.eq('site_id', siteId);
    const { data, error } = await q;
    if (error) {
      if (/gd_site_events|does not exist|relation/i.test(error.message)) {
        return { rows: [], missingTable: true };
      }
      throw error;
    }
    if (!data?.length) break;
    out.push(...(data as EventRow[]));
    if (data.length < 1000) break;
  }
  return { rows: out, missingTable: false };
}

type PeriodMetrics = {
  visitors: number;
  views: number;
  visits: number;
  avgSec: number;
  pagesPerVisit: number;
  bounceRate: number;
  newRate: number;
};

function computeMetrics(pvs: EventRow[]): PeriodMetrics {
  const visitors = new Set<string>();
  const newVisitors = new Set<string>();
  const sessions = new Map<string, { views: number; dur: number }>();

  for (const e of pvs) {
    visitors.add(e.visitor_id);
    if (e.is_new) newVisitors.add(e.visitor_id);
    const s = sessions.get(e.session_id) || { views: 0, dur: 0 };
    s.views += 1;
    s.dur += Number(e.duration_sec) || 0;
    sessions.set(e.session_id, s);
  }

  const visits = sessions.size;
  let totalDur = 0;
  let bounces = 0;
  for (const s of sessions.values()) {
    totalDur += s.dur;
    if (s.views === 1) bounces += 1;
  }

  return {
    visitors: visitors.size,
    views: pvs.length,
    visits,
    avgSec: visits ? Math.round(totalDur / visits) : 0,
    pagesPerVisit: visits ? Number((pvs.length / visits).toFixed(1)) : 0,
    bounceRate: visits ? bounces / visits : 0,
    newRate: visitors.size ? newVisitors.size / visitors.size : 0,
  };
}

function topCounts<T extends string>(items: (T | null | undefined)[], fallback: string, limit = 10) {
  const map = new Map<string, number>();
  for (const it of items) {
    const k = it || fallback;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function visitorTopCounts(pvs: EventRow[], pick: (e: EventRow) => string | null | undefined, fallback: string, limit = 10) {
  const map = new Map<string, Set<string>>();
  for (const e of pvs) {
    const k = pick(e) || fallback;
    let set = map.get(k);
    if (!set) { set = new Set(); map.set(k, set); }
    set.add(e.visitor_id);
  }
  const total = new Set(pvs.map((e) => e.visitor_id)).size || 1;
  return [...map.entries()]
    .map(([name, set]) => ({ name, count: set.size, pct: set.size / total }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function portfolioReport(workspaceId: string, days: number) {
  const sb = sbAdmin();
  const { data: monRows } = await sb
    .from('gd_records')
    .select('id, data')
    .eq('workspace_id', workspaceId)
    .eq('collection', 'monitors');

  const sites = (monRows ?? [])
    .filter((r) => isMonitorSite(r.data as Record<string, any>))
    .map(toSiteRecord);

  const now = new Date();
  const curStart = new Date(now.getTime() - days * 864e5);
  const prevStart = new Date(now.getTime() - days * 2 * 864e5);
  const { rows: allRows, missingTable } = await fetchEvents(workspaceId, prevStart.toISOString());

  const siteMap = new Map(sites.map((s) => [s.id, s]));
  const pvsAll = allRows.filter((e) => e.kind === 'pageview' && siteMap.has(e.site_id));
  const convs30 = allRows.filter((e) => e.kind === 'conversion' && siteMap.has(e.site_id) && new Date(e.created_at).getTime() >= now.getTime() - 30 * 864e5);

  const curPvs = pvsAll.filter((e) => new Date(e.created_at) >= curStart);
  const prevPvs = pvsAll.filter((e) => new Date(e.created_at) < curStart);

  // Realtime: active in last 5 minutes
  const fiveMinAgo = now.getTime() - 5 * 60_000;
  const activeVisitorsBySite = new Map<string, Set<string>>();
  const activeAll = new Set<string>();
  for (const e of curPvs) {
    const seen = Math.max(new Date(e.last_seen_at || e.created_at).getTime(), new Date(e.created_at).getTime());
    if (seen >= fiveMinAgo) {
      activeAll.add(e.visitor_id);
      let set = activeVisitorsBySite.get(e.site_id);
      if (!set) { set = new Set(); activeVisitorsBySite.set(e.site_id, set); }
      set.add(e.visitor_id);
    }
  }

  // Views per minute (last 30 minutes)
  const perMinute = Array.from({ length: 30 }, () => 0);
  const thirtyMinAgo = now.getTime() - 30 * 60_000;
  let viewsLast30m = 0;
  for (const e of curPvs) {
    const t = new Date(e.created_at).getTime();
    if (t >= thirtyMinAgo) {
      const idx = Math.min(29, Math.max(0, Math.floor((t - thirtyMinAgo) / 60_000)));
      perMinute[idx] += 1;
      viewsLast30m += 1;
    }
  }

  // Today vs Yesterday
  const todayStr = ilDay(now);
  const yestStr = ilDay(new Date(now.getTime() - 864e5));
  const todayPvs = curPvs.filter((e) => ilDay(new Date(e.created_at)) === todayStr);
  const yestPvs = pvsAll.filter((e) => ilDay(new Date(e.created_at)) === yestStr);
  const todayVisitors = new Set(todayPvs.map((e) => e.visitor_id)).size;
  const yestVisitors = new Set(yestPvs.map((e) => e.visitor_id)).size;
  const activeSitesToday = new Set(todayPvs.map((e) => e.site_id)).size;

  const curM = computeMetrics(curPvs);
  const prevM = computeMetrics(prevPvs);

  // Daily trend stacked by site
  const dList = dayList(days, now);
  const daySiteVisitors = new Map<string, Map<string, Set<string>>>();
  for (const d of dList) daySiteVisitors.set(d, new Map());
  for (const e of curPvs) {
    const d = ilDay(new Date(e.created_at));
    const sm = daySiteVisitors.get(d);
    if (!sm) continue;
    let set = sm.get(e.site_id);
    if (!set) { set = new Set(); sm.set(e.site_id, set); }
    set.add(e.visitor_id);
  }

  let peakDay = dList[dList.length - 1] || todayStr;
  let peakVal = 0;
  let totalDayVisitors = 0;
  const trendDays = dList.map((day) => {
    const sm = daySiteVisitors.get(day)!;
    const bySite: Record<string, number> = {};
    let total = 0;
    for (const s of sites) {
      const c = sm.get(s.id)?.size ?? 0;
      if (c > 0) bySite[s.id] = c;
      total += c;
    }
    if (total > peakVal) { peakVal = total; peakDay = day; }
    totalDayVisitors += total;
    return { day, total, bySite };
  });

  // Per-site summaries
  const siteSummaries = sites.map((s) => {
    const sCur = curPvs.filter((e) => e.site_id === s.id);
    const sPrev = prevPvs.filter((e) => e.site_id === s.id);
    const sToday = todayPvs.filter((e) => e.site_id === s.id);
    const m = computeMetrics(sCur);
    const pm = computeMetrics(sPrev);
    const spark = trendDays.slice(-14).map((d) => d.bySite[s.id] ?? 0);
    const convCount = convs30.filter((e) => e.site_id === s.id).length;
    return {
      id: s.id,
      name: s.name,
      domain: s.domain,
      url: s.url,
      owner: s.owner || '',
      site_key: s.site_key || '',
      ga_property: s.ga_property || '',
      gsc_site: s.gsc_site || '',
      online: activeVisitorsBySite.get(s.id)?.size ?? 0,
      visitors: m.visitors,
      visitorsDelta: pctDelta(m.visitors, pm.visitors),
      todayVisitors: new Set(sToday.map((e) => e.visitor_id)).size,
      views: m.views,
      avgSec: m.avgSec,
      bounceRate: m.bounceRate,
      spark,
      conversionsCount: convCount,
      hasData: sCur.length > 0,
    };
  }).sort((a, b) => b.visitors - a.visitors);

  const totalSiteVisitors = siteSummaries.reduce((a, s) => a + s.visitors, 0) || 1;
  const shares = siteSummaries.map((s) => ({
    id: s.id,
    name: s.name,
    visitors: s.visitors,
    pct: s.visitors / totalSiteVisitors,
  }));

  // Heatmap (7 days × 24 hours)
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const hourTotals = Array.from({ length: 24 }, () => 0);
  for (const e of curPvs) {
    const dt = new Date(e.created_at);
    const dow = ilDow(dt);
    const hr = ilHour(dt);
    heatmap[dow][hr] += 1;
    hourTotals[hr] += 1;
  }
  let peakHourIdx = 0;
  for (let h = 1; h < 24; h++) {
    if (hourTotals[h] > hourTotals[peakHourIdx]) peakHourIdx = h;
  }
  const peakHour = curPvs.length
    ? `${String(peakHourIdx).padStart(2, '0')}:00–${String((peakHourIdx + 1) % 24).padStart(2, '0')}:00`
    : null;

  // Sources, devices, browsers
  const sources = visitorTopCounts(curPvs, (e) => e.referrer, 'ישיר', 10);
  const devicesRaw = visitorTopCounts(curPvs, (e) => e.device, 'mobile', 3);
  const devices = (['mobile', 'desktop', 'tablet'] as const).map((kind) => {
    const found = devicesRaw.find((d) => d.name === kind);
    return { kind, count: found?.count ?? 0, pct: found?.pct ?? 0 };
  });
  const browsers = visitorTopCounts(curPvs, (e) => e.browser, 'אחר', 8).map(({ name, count }) => ({ name, count }));

  // Top pages across all sites
  const pageAgg = new Map<string, { title: string; path: string; siteId: string; siteName: string; views: number; durSum: number; durCnt: number }>();
  for (const e of curPvs) {
    const key = `${e.site_id}::${e.path}`;
    const s = siteMap.get(e.site_id);
    const cur = pageAgg.get(key) || {
      title: e.title || e.path,
      path: e.path,
      siteId: e.site_id,
      siteName: s?.name || '',
      views: 0,
      durSum: 0,
      durCnt: 0,
    };
    cur.views += 1;
    if (e.title && cur.title === cur.path) cur.title = e.title;
    if (e.duration_sec > 0) { cur.durSum += e.duration_sec; cur.durCnt += 1; }
    pageAgg.set(key, cur);
  }
  const topPages = [...pageAgg.values()]
    .sort((a, b) => b.views - a.views)
    .slice(0, 12)
    .map((p) => ({
      title: p.title,
      path: p.path,
      siteId: p.siteId,
      siteName: p.siteName,
      views: p.views,
      avgSec: p.durCnt ? Math.round(p.durSum / p.durCnt) : 0,
    }));

  // Live feed (last 18 pageviews)
  const liveFeed = curPvs.slice(0, 18).map((e) => {
    const s = siteMap.get(e.site_id);
    const agoMin = Math.max(0, Math.round((now.getTime() - new Date(e.created_at).getTime()) / 60_000));
    return {
      id: e.id,
      siteId: e.site_id,
      siteName: s?.name || '',
      title: e.title || e.path,
      path: e.path,
      source: e.referrer || 'ישיר',
      device: e.device || 'mobile',
      agoMin,
      at: e.created_at,
    };
  });

  // Insights
  const topSite = siteSummaries[0]?.visitors > 0 ? { id: siteSummaries[0].id, name: siteSummaries[0].name } : null;
  const growingCandidate = [...siteSummaries]
    .filter((s) => s.visitorsDelta != null && s.visitorsDelta > 0)
    .sort((a, b) => (b.visitorsDelta ?? 0) - (a.visitorsDelta ?? 0))[0];
  const needsCheckCandidate = [...siteSummaries]
    .filter((s) => s.visitors === 0 || (s.visitorsDelta != null && s.visitorsDelta < -0.25))
    .sort((a, b) => a.visitors - b.visitors)[0];
  const mobilePct = devices.find((d) => d.kind === 'mobile')?.pct ?? 0;

  return {
    missingTable,
    hasData: curPvs.length > 0,
    range: { days, since: dList[0] || todayStr, until: todayStr },
    realtime: {
      online: activeAll.size,
      bySite: [...activeVisitorsBySite.entries()]
        .map(([id, set]) => ({ id, name: siteMap.get(id)?.name || '', count: set.size }))
        .sort((a, b) => b.count - a.count),
      perMinute,
      viewsLast30m,
    },
    today: {
      visitors: todayVisitors,
      visitorsDelta: pctDelta(todayVisitors, yestVisitors),
      views: todayPvs.length,
      viewsDelta: pctDelta(todayPvs.length, yestPvs.length),
      activeSites: activeSitesToday,
      totalSites: sites.length,
    },
    kpis: {
      visitors: curM.visitors,
      visitorsDelta: pctDelta(curM.visitors, prevM.visitors),
      views: curM.views,
      viewsDelta: pctDelta(curM.views, prevM.views),
      visits: curM.visits,
      visitsDelta: pctDelta(curM.visits, prevM.visits),
      avgSec: curM.avgSec,
      avgSecDelta: pctDelta(curM.avgSec, prevM.avgSec),
      bounceRate: curM.bounceRate,
      bounceDelta: pctDelta(curM.bounceRate, prevM.bounceRate),
      newRate: curM.newRate,
      newDelta: pctDelta(curM.newRate, prevM.newRate),
    },
    trend: {
      days: trendDays,
      peak: { day: peakDay, value: peakVal },
      avgPerDay: dList.length ? Math.round(totalDayVisitors / dList.length) : 0,
      shares,
    },
    insights: {
      topSite,
      growingSite: growingCandidate ? { id: growingCandidate.id, name: growingCandidate.name, delta: growingCandidate.visitorsDelta } : null,
      needsCheck: needsCheckCandidate ? { id: needsCheckCandidate.id, name: needsCheckCandidate.name } : null,
      peakHour,
      topSource: sources[0]?.name ?? null,
      topPage: topPages[0] ? { title: topPages[0].title, path: topPages[0].path, siteId: topPages[0].siteId } : null,
      mobilePct: curPvs.length ? mobilePct : null,
    },
    sites: siteSummaries,
    liveFeed,
    sources,
    devices,
    browsers,
    heatmap,
    topPages,
  };
}

export async function siteDetailReport(workspaceId: string, row: { id: string; data: any }, days: number) {
  const site = toSiteRecord(row);
  const now = new Date();
  const curStart = new Date(now.getTime() - days * 864e5);
  const prevStart = new Date(now.getTime() - Math.max(days * 2, 30) * 864e5);
  const { rows: allRows, missingTable } = await fetchEvents(workspaceId, prevStart.toISOString(), site.id);

  const pvsAll = allRows.filter((e) => e.kind === 'pageview');
  const curPvs = pvsAll.filter((e) => new Date(e.created_at) >= curStart);
  const prevWindowStart = new Date(now.getTime() - days * 2 * 864e5);
  const prevPvs = pvsAll.filter((e) => {
    const dt = new Date(e.created_at);
    return dt < curStart && dt >= prevWindowStart;
  });

  // Realtime: online + where they are now
  const fiveMinAgo = now.getTime() - 5 * 60_000;
  const onlineVisitors = new Set<string>();
  const latestByVisitor = new Map<string, EventRow>();
  for (const e of curPvs) {
    const seen = Math.max(new Date(e.last_seen_at || e.created_at).getTime(), new Date(e.created_at).getTime());
    if (seen >= fiveMinAgo) {
      onlineVisitors.add(e.visitor_id);
      if (!latestByVisitor.has(e.visitor_id)) latestByVisitor.set(e.visitor_id, e);
    }
  }
  const onlinePagesMap = new Map<string, { title: string; path: string; count: number }>();
  for (const e of latestByVisitor.values()) {
    const cur = onlinePagesMap.get(e.path) || { title: e.title || e.path, path: e.path, count: 0 };
    cur.count += 1;
    onlinePagesMap.set(e.path, cur);
  }
  const onlinePages = [...onlinePagesMap.values()].sort((a, b) => b.count - a.count);

  const curM = computeMetrics(curPvs);
  const prevM = computeMetrics(prevPvs);

  // Daily visitors in range
  const dList = dayList(days, now);
  const dayV = new Map<string, Set<string>>();
  const dayViews = new Map<string, number>();
  for (const d of dList) { dayV.set(d, new Set()); dayViews.set(d, 0); }
  for (const e of curPvs) {
    const d = ilDay(new Date(e.created_at));
    dayV.get(d)?.add(e.visitor_id);
    if (dayViews.has(d)) dayViews.set(d, (dayViews.get(d) || 0) + 1);
  }
  const daily = dList.map((day) => ({
    day,
    visitors: dayV.get(day)?.size ?? 0,
    views: dayViews.get(day) ?? 0,
  }));

  // Today by hour (0:00 - 23:00)
  const todayStr = ilDay(now);
  const hourV = Array.from({ length: 24 }, () => new Set<string>());
  const hourViews = Array.from({ length: 24 }, () => 0);
  for (const e of curPvs) {
    const dt = new Date(e.created_at);
    if (ilDay(dt) === todayStr) {
      const hr = ilHour(dt);
      hourV[hr].add(e.visitor_id);
      hourViews[hr] += 1;
    }
  }
  const hourlyToday = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    visitors: hourV[hour].size,
    views: hourViews[hour],
  }));

  // Top pages (views, unique visitors, avg duration)
  const pageAgg = new Map<string, { title: string; path: string; views: number; visitors: Set<string>; durSum: number; durCnt: number }>();
  for (const e of curPvs) {
    const cur = pageAgg.get(e.path) || { title: e.title || e.path, path: e.path, views: 0, visitors: new Set(), durSum: 0, durCnt: 0 };
    cur.views += 1;
    cur.visitors.add(e.visitor_id);
    if (e.title && cur.title === cur.path) cur.title = e.title;
    if (e.duration_sec > 0) { cur.durSum += e.duration_sec; cur.durCnt += 1; }
    pageAgg.set(e.path, cur);
  }
  const topPages = [...pageAgg.values()]
    .sort((a, b) => b.views - a.views)
    .slice(0, 15)
    .map((p) => ({
      title: p.title,
      path: p.path,
      views: p.views,
      visitors: p.visitors.size,
      avgSec: p.durCnt ? Math.round(p.durSum / p.durCnt) : 0,
    }));

  // Landing pages (first pageview of each session)
  const firstBySession = new Map<string, EventRow>();
  for (let i = curPvs.length - 1; i >= 0; i--) {
    const e = curPvs[i];
    if (!firstBySession.has(e.session_id)) firstBySession.set(e.session_id, e);
  }
  const landingPages = topCounts([...firstBySession.values()].map((e) => e.path), '/', 10)
    .map(({ name, count }) => ({ path: name, count }));

  // Sources, devices, browsers, countries
  const sources = visitorTopCounts(curPvs, (e) => e.referrer, 'ישיר', 10);
  const devicesRaw = visitorTopCounts(curPvs, (e) => e.device, 'mobile', 3);
  const devices = (['mobile', 'desktop', 'tablet'] as const).map((kind) => {
    const found = devicesRaw.find((d) => d.name === kind);
    return { kind, count: found?.count ?? 0, pct: found?.pct ?? 0 };
  });
  const browsers = visitorTopCounts(curPvs, (e) => e.browser, 'אחר', 8).map(({ name, count }) => ({ name, count }));
  const countries = visitorTopCounts(curPvs, (e) => e.country, 'לא ידוע', 10).map(({ name, count }) => ({ name, count }));

  // Conversions (30 days)
  const thirtyDaysAgo = now.getTime() - 30 * 864e5;
  const convEvents = allRows.filter((e) => e.kind === 'conversion' && new Date(e.created_at).getTime() >= thirtyDaysAgo);
  const conversions = site.conversions.map((c) => {
    const matched = convEvents.filter((e) => e.conversion_id === c.id);
    const fromAds = matched.filter((e) => e.from_ads).length;
    const sentToGoogle = matched.filter((e) => e.google_sent).length;
    return {
      ...c,
      total30d: matched.length,
      fromAds30d: fromAds,
      sentToGoogle30d: sentToGoogle,
    };
  });

  const googleLog = convEvents
    .filter((e) => e.from_ads || e.google_sent)
    .slice(0, 20)
    .map((e) => ({
      id: e.id,
      at: e.created_at,
      name: e.conversion_name || 'המרה',
      path: e.path,
      gclid: e.gclid,
      value: e.conversion_value,
      sent: e.google_sent,
    }));

  return {
    missingTable,
    hasData: curPvs.length > 0,
    site,
    online: onlineVisitors.size,
    onlinePages,
    kpis: {
      visitors: curM.visitors,
      visitorsDelta: pctDelta(curM.visitors, prevM.visitors),
      views: curM.views,
      viewsDelta: pctDelta(curM.views, prevM.views),
      visits: curM.visits,
      visitsDelta: pctDelta(curM.visits, prevM.visits),
      avgSec: curM.avgSec,
      pagesPerVisit: curM.pagesPerVisit,
      bounceRate: curM.bounceRate,
      newRate: curM.newRate,
    },
    daily,
    hourlyToday,
    topPages,
    landingPages,
    sources,
    devices,
    browsers,
    countries,
    conversions,
    googleLog,
  };
}
