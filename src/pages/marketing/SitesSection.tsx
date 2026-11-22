import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Check, ChevronDown, ChevronLeft, Clock, Code2,
  Copy, ExternalLink, Eye, FileText, Globe, Link2, Monitor, MousePointerClick, Pencil, Phone,
  Plus, RefreshCw, Rocket, Search, Share2, Smartphone, Sparkles, Tablet, Target, Trash2, Trophy, Users, MessageCircle,
} from 'lucide-react';
import { api } from '../../lib/api';
import { DEMO } from '../../lib/config';
import { store, useCollection } from '../../data/store';
import { shortDate, uid } from '../../lib/format';
import { useCrud } from '../../ui/crud';
import { Spark } from '../../ui/charts';
import { Badge, Card, CardHead, Delta, DotNum, Empty, Kpi, PillTabs, Stagger, TabBody, Toggle, easeOut } from '../../ui/kit';
import { Sheet, useToast } from '../../ui/overlay';

/* ================= Types ================= */
export type SiteConversion = {
  id: string;
  name: string;
  type: 'form' | 'whatsapp' | 'phone' | 'button' | 'page';
  selector: string;
  primary?: boolean;
  value?: number;
  google_ads?: boolean;
  last_tested_at?: string;
  total30d?: number;
  fromAds30d?: number;
  sentToGoogle30d?: number;
};

type SiteSummary = {
  id: string;
  name: string;
  domain: string;
  url: string;
  owner: string;
  site_key: string;
  ga_property?: string;
  gsc_site?: string;
  online: number;
  visitors: number;
  visitorsDelta: number | null;
  todayVisitors: number;
  views: number;
  avgSec: number;
  bounceRate: number;
  spark: number[];
  conversionsCount: number;
  hasData: boolean;
};

type PortfolioReport = {
  missingTable?: boolean;
  hasData: boolean;
  range: { days: number; since: string; until: string };
  realtime: {
    online: number;
    bySite: { id: string; name: string; count: number }[];
    perMinute: number[];
    viewsLast30m: number;
  };
  today: {
    visitors: number;
    visitorsDelta: number | null;
    views: number;
    viewsDelta: number | null;
    activeSites: number;
    totalSites: number;
  };
  kpis: {
    visitors: number;
    visitorsDelta: number | null;
    views: number;
    viewsDelta: number | null;
    visits: number;
    visitsDelta: number | null;
    avgSec: number;
    avgSecDelta: number | null;
    bounceRate: number;
    bounceDelta: number | null;
    newRate: number;
    newDelta: number | null;
  };
  trend: {
    days: { day: string; total: number; bySite: Record<string, number> }[];
    peak: { day: string; value: number };
    avgPerDay: number;
    shares: { id: string; name: string; visitors: number; pct: number }[];
  };
  insights: {
    topSite: { id: string; name: string } | null;
    growingSite: { id: string; name: string; delta: number | null } | null;
    needsCheck: { id: string; name: string } | null;
    peakHour: string | null;
    topSource: string | null;
    topPage: { title: string; path: string; siteId: string } | null;
    mobilePct: number | null;
  };
  sites: SiteSummary[];
  liveFeed: { id: string; siteId: string; siteName: string; title: string; path: string; source: string; device: string; agoMin: number; at: string }[];
  sources: { name: string; count: number; pct: number }[];
  devices: { kind: 'mobile' | 'desktop' | 'tablet'; count: number; pct: number }[];
  browsers: { name: string; count: number }[];
  heatmap: number[][];
  topPages: { title: string; path: string; siteId: string; siteName: string; views: number; avgSec: number }[];
};

type SiteDetailReport = {
  missingTable?: boolean;
  hasData: boolean;
  site: { id: string; name: string; domain: string; url: string; site_key?: string; shared?: boolean; conversions: SiteConversion[] };
  online: number;
  onlinePages: { title: string; path: string; count: number }[];
  kpis: {
    visitors: number;
    visitorsDelta: number | null;
    views: number;
    viewsDelta: number | null;
    visits: number;
    visitsDelta: number | null;
    avgSec: number;
    pagesPerVisit: number;
    bounceRate: number;
    newRate: number;
  };
  daily: { day: string; visitors: number; views: number }[];
  hourlyToday: { hour: number; visitors: number; views: number }[];
  topPages: { title: string; path: string; views: number; visitors: number; avgSec: number }[];
  landingPages: { path: string; count: number }[];
  sources: { name: string; count: number; pct?: number }[];
  devices: { kind: 'mobile' | 'desktop' | 'tablet'; count: number; pct: number }[];
  browsers: { name: string; count: number }[];
  countries: { name: string; count: number }[];
  conversions: SiteConversion[];
  googleLog: { id: string; at: string; name: string; path: string; gclid: string | null; value: number | null; sent: boolean }[];
  google?: {
    ga: null | { users: number; sessions: number; views: number; avgSec: number; keyEvents: number };
    search: null | { site: string; clicks: number; impressions: number; ctr: number; position: number; queries: { q: string; clicks: number; impressions: number }[] };
    warnings: string[];
  } | null;
};

/* ================= Helpers ================= */
const nf = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const cnt = (v: number | null | undefined) => (v == null ? '—' : nf.format(v));
const pct0 = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const durHe = (sec: number) => {
  if (!sec || sec < 1) return '0 שנ׳';
  if (sec < 60) return `${Math.round(sec)} שנ׳`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')} דק׳`;
};
const decodeSafe = (s: string) => { try { return decodeURI(s); } catch { return s; } };
const cleanDomain = (raw?: string) => {
  if (!raw) return '';
  let s = raw.trim().toLowerCase();
  try { if (s.includes('://')) s = new URL(s).hostname; } catch { /* ignore */ }
  return s.replace(/^www\./, '').replace(/\/.*$/, '');
};
const makeSiteKey = () => `st_${uid().replace(/-/g, '').slice(0, 12)}`;
const embedSnippet = (siteKey: string) => {
  const origin = typeof location !== 'undefined' ? location.origin : 'https://your-dashboard.vercel.app';
  return `<script defer src="${origin}/api/t?s=${siteKey}"></script>`;
};

const SITE_PALETTE = ['#D64C86', '#3340D6', '#2A9A78', '#E08A1E', '#7E64D9', '#5F8A99'];
const DAYS_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const CONV_TYPES: { value: SiteConversion['type']; label: string; prefix: string; placeholder: string; icon: typeof FileText }[] = [
  { value: 'form', label: 'טופס נשלח', prefix: 'טופס', placeholder: 'tryLeadForm או #msLeadForm', icon: FileText },
  { value: 'whatsapp', label: 'וואטסאפ', prefix: 'וואטסאפ', placeholder: 'ריק = כל קישור וואטסאפ באתר', icon: MessageCircle },
  { value: 'phone', label: 'טלפון', prefix: 'טלפון', placeholder: 'ריק = כל לחיצה על מספר טלפון', icon: Phone },
  { value: 'button', label: 'כפתור', prefix: 'כפתור', placeholder: 'טקסט הכפתור או בורר CSS', icon: MousePointerClick },
  { value: 'page', label: 'עמוד', prefix: 'עמוד', placeholder: '/thank-you/', icon: Globe },
];

function useApiData<T>(path: string | null, demoFn: () => T, deps: unknown[] = []) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) { setState({ loading: false }); return; }
    if (DEMO) { setState({ data: demoFn(), loading: false }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    api<T>(path)
      .then((data) => live && setState({ data, loading: false }))
      .catch((e) => live && setState({ error: e.message, loading: false }));
    return () => { live = false; };
  }, [path, tick, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: () => setTick((t) => t + 1) };
}

function DeviceIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  if (kind === 'desktop') return <Monitor size={size} />;
  if (kind === 'tablet') return <Tablet size={size} />;
  return <Smartphone size={size} />;
}

/* ================= Main Export ================= */
export function SitesSection({ days }: { days: number }) {
  const { siteId } = useParams();
  const nav = useNavigate();
  const monitors = useCollection('monitors');
  const [newOpen, setNewOpen] = useState(false);
  const [codeFor, setCodeFor] = useState<{ name: string; domain: string; url: string; site_key: string } | null>(null);

  const sites = useMemo(
    () => monitors.filter((m) => m.kind === 'אתר' && (!/vercel\.app|localhost|127\.0\.0\.1/.test(m.url || '') || !!m.site_key)),
    [monitors],
  );

  const selectedSite = siteId ? sites.find((s) => s.id === siteId) : undefined;

  const ensureSiteKey = (m: any) => {
    if (m.site_key) return m.site_key as string;
    const key = makeSiteKey();
    store.update('monitors', m.id, { site_key: key });
    return key;
  };

  const openCode = (m: any) => {
    const key = ensureSiteKey(m);
    setCodeFor({ name: m.name, domain: cleanDomain(m.domain || m.url), url: m.url || '', site_key: key });
  };

  return (
    <>
      {selectedSite ? (
        <TabBody id={`site-${selectedSite.id}`}>
          <SiteDetailView
            siteRec={selectedSite}
            days={days}
            onBack={() => nav('/marketing/sites')}
            onOpenCode={() => openCode(selectedSite)}
          />
        </TabBody>
      ) : (
        <TabBody id="sites-all">
          <SitesOverview
            sites={sites}
            days={days}
            onSelect={(id) => nav(`/marketing/sites/${id}`)}
            onNewSite={() => setNewOpen(true)}
            onOpenCode={openCode}
          />
        </TabBody>
      )}

      <NewSiteSheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(rec) => {
          setNewOpen(false);
          setCodeFor({ name: rec.name, domain: rec.domain, url: rec.url, site_key: rec.site_key });
        }}
      />
      <EmbedCodeSheet site={codeFor} onClose={() => setCodeFor(null)} />
    </>
  );
}

/* ================= Portfolio Overview (PDF #1) ================= */
function SitesOverview({
  sites, days, onSelect, onNewSite, onOpenCode,
}: {
  sites: any[];
  days: number;
  onSelect: (id: string) => void;
  onNewSite: () => void;
  onOpenCode: (m: any) => void;
}) {
  const [rankTab, setRankTab] = useState<'now' | 'today' | 'period'>('today');
  const r = useApiData<PortfolioReport>(
    `/api/marketing?source=sites_overview&days=${days}`,
    () => demoPortfolio(sites, days),
    [sites.length, days],
  );

  if (r.loading && !r.data) return <SitesLoading />;
  if (r.error) return <SitesError text={r.error} onRetry={r.reload} />;
  const d = r.data!;

  if (!sites.length && !d.sites.length) {
    return (
      <Stagger>
        <Card className="lg-12">
          <Empty
            icon={Globe}
            title="אין עדיין אתרים מחוברים"
            text="צור אתר חדש, הדבק שורת קוד אחת באתר ותראה תנועה בזמן אמת, מקורות הגעה והמרות."
            action={<button className="btn btn-primary" onClick={onNewSite}><Plus size={16} />אתר חדש</button>}
          />
        </Card>
      </Stagger>
    );
  }

  const maxMin = Math.max(1, ...d.realtime.perMinute);
  const rankList = [...d.sites]
    .map((s) => ({
      id: s.id,
      name: s.name,
      val: rankTab === 'now' ? s.online : rankTab === 'today' ? s.todayVisitors : s.visitors,
    }))
    .sort((a, b) => b.val - a.val);
  const rankTotal = rankList.reduce((a, x) => a + x.val, 0) || 1;
  const maxSource = Math.max(1, ...(d.sources.map((s) => s.count)));

  return (
    <Stagger>
      {/* Top bar: status + add new site */}
      <div className="lg-12 spread wrap" style={{ gap: 10 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <Badge kind={d.realtime.online > 0 ? 'pos' : 'none'} icon={false}>
            <span className="row" style={{ gap: 6 }}>
              <span className="pulse" style={{ width: 7, height: 7, background: d.realtime.online > 0 ? 'var(--pos)' : 'var(--ink-3)' }} />
              תנועה בזמן אמת · {d.sites.length} אתרים
            </span>
          </Badge>
          {DEMO && <Badge kind="info">נתוני הדגמה · בחשבון האמיתי יוצגו נתוני האתרים המחוברים</Badge>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={r.reload}><RefreshCw size={14} />רענון</button>
          <button className="btn btn-primary btn-sm" onClick={onNewSite}><Plus size={15} />אתר חדש</button>
        </div>
      </div>

      {d.missingTable && (
        <Card className="lg-12" style={{ background: 'var(--warn-bg)', borderColor: 'transparent' }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2, color: 'var(--warn)' }} />
            <div>
              <b style={{ fontWeight: 500 }}>טבלת נתוני האתרים עדיין לא הוקמה במסד הנתונים</b>
              <p className="meta" style={{ marginTop: 4 }}>
                יש להריץ את המיגרציה <bdi className="ltr">supabase/migrations/20261122000001_gd_site_analytics.sql</bdi> ב־Supabase כדי להתחיל לאסוף תנועה והמרות.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Hero: Live visitors + views per minute */}
      <Card className="hero hero-slate lg-5 md-12">
        <div className="spread">
          <span className="hero-label">
            <span className="pulse" style={{ width: 8, height: 8, background: 'var(--lime)' }} />
            מחוברים עכשיו
          </span>
          <span className="hero-chip">{cnt(d.realtime.viewsLast30m)} צפיות ב־30 דק׳</span>
        </div>
        <div className="hero-num">
          <DotNum value={cnt(d.realtime.online)} label={`${d.realtime.online} מחוברים עכשיו`} />
        </div>
        <div className="hero-sub">
          {d.realtime.bySite.length
            ? d.realtime.bySite.map((s) => `${s.name} ${s.count}`).join(' · ')
            : 'אין מבקרים מחוברים ב־5 הדקות האחרונות'}
        </div>
        <div className="hero-ticks" role="img" aria-label="צפיות לדקה ב-30 הדקות האחרונות" title="צפיות לדקה (30 דק׳ אחרונות)">
          {d.realtime.perMinute.map((v, i) => (
            <i key={i} className={v > 0 ? 'on' : ''} style={{ height: `${Math.max(10, (v / maxMin) * 100)}%` }} />
          ))}
        </div>
        <div className="spread" style={{ fontSize: 11, opacity: 0.78, marginTop: 6 }}>
          <span>עכשיו</span>
          <span>צפיות לדקה</span>
          <span>לפני 30 דק׳</span>
        </div>
      </Card>

      {/* Today's snapshot (4 stats) */}
      <Card className="lg-7 md-12">
        <CardHead title="תמונת מצב להיום" sub={`${shortDate(d.range.since)} עד ${shortDate(d.range.until)}`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 18 }}>
          <Kpi
            label="מבקרים היום"
            icon={Users}
            value={d.hasData ? cnt(d.today.visitors) : 'אין נתונים'}
            delta={d.hasData ? d.today.visitorsDelta : null}
            foot={d.hasData ? 'מאתמול' : undefined}
          />
          <Kpi
            label="צפיות היום"
            icon={Eye}
            value={d.hasData ? cnt(d.today.views) : 'אין נתונים'}
            delta={d.hasData ? d.today.viewsDelta : null}
            foot={d.hasData ? 'מאתמול' : undefined}
          />
          <Kpi
            label="מבקרים בתקופה"
            icon={BarChart3}
            value={d.hasData ? cnt(d.kpis.visitors) : '—'}
            foot={`${d.range.days} ימים אחרונים`}
          />
          <Kpi
            label="אתרים עם תנועה היום"
            icon={Globe}
            value={<span className="ltr num">{d.today.activeSites}/{d.today.totalSites}</span>}
            foot={d.today.activeSites < d.today.totalSites ? `${d.today.totalSites - d.today.activeSites} ללא תנועה היום` : 'כל האתרים פעילים'}
          />
        </div>
      </Card>

      {/* 6 Period KPIs */}
      <Card className="lg-4 md-6 sm-6"><Kpi label="מבקרים" icon={Users} value={d.hasData ? cnt(d.kpis.visitors) : '—'} delta={d.hasData ? d.kpis.visitorsDelta : null} /></Card>
      <Card className="lg-4 md-6 sm-6"><Kpi label="צפיות" icon={Eye} value={d.hasData ? cnt(d.kpis.views) : '—'} delta={d.hasData ? d.kpis.viewsDelta : null} /></Card>
      <Card className="lg-4 md-6 sm-6"><Kpi label="ביקורים" icon={Activity} value={d.hasData ? cnt(d.kpis.visits) : '—'} delta={d.hasData ? d.kpis.visitsDelta : null} /></Card>
      <Card className="lg-4 md-6 sm-6"><Kpi label="זמן ממוצע" icon={Clock} value={d.hasData ? durHe(d.kpis.avgSec) : '—'} delta={d.hasData ? d.kpis.avgSecDelta : null} /></Card>
      <Card className="lg-4 md-6 sm-6"><Kpi label="נטישה" icon={ExternalLink} value={d.hasData ? pct0(d.kpis.bounceRate) : '—'} delta={d.hasData ? d.kpis.bounceDelta : null} invert /></Card>
      <Card className="lg-4 md-6 sm-6"><Kpi label="חדשים" icon={Sparkles} value={d.hasData ? pct0(d.kpis.newRate) : '—'} delta={d.hasData ? d.kpis.newDelta : null} /></Card>

      {/* Stacked Trend Chart by Site */}
      <Card className="lg-8 md-12">
        <CardHead
          title="מגמת תנועה"
          sub={d.hasData ? `שיא ${cnt(d.trend.peak.value)} · ${shortDate(d.trend.peak.day)} · ממוצע ${cnt(d.trend.avgPerDay)} ליום` : 'מבקרים ליום לפי אתר'}
        />
        {d.hasData ? (
          <StackedSitesChart trend={d.trend} />
        ) : (
          <Empty icon={BarChart3} title="אין נתונים עדיין" text="ברגע שקוד ההטמעה יפעל באתר אחד לפחות, מגמת התנועה תופיע כאן." />
        )}
      </Card>

      {/* Insights */}
      <Card className="flush lg-4 md-12">
        <div className="card-head" style={{ padding: '20px 20px 6px', marginBottom: 0 }}>
          <div><h2>תובנות</h2><div className="sub">סיכום אוטומטי לתקופה</div></div>
        </div>
        {d.hasData ? (
          <div className="list">
            {d.insights.topSite && (
              <button className="li clickable" style={{ width: '100%', textAlign: 'start' }} onClick={() => onSelect(d.insights.topSite!.id)}>
                <span className="li-icon"><Trophy size={16} /></span>
                <span className="li-main"><span className="li-meta">האתר המוביל</span><span className="li-title" style={{ display: 'block' }}>{d.insights.topSite.name}</span></span>
                <ChevronLeft size={16} className="muted" />
              </button>
            )}
            {d.insights.growingSite && (
              <button className="li clickable" style={{ width: '100%', textAlign: 'start' }} onClick={() => onSelect(d.insights.growingSite!.id)}>
                <span className="li-icon" style={{ color: 'var(--pos)', background: 'var(--pos-bg)' }}><Rocket size={16} /></span>
                <span className="li-main"><span className="li-meta">בצמיחה</span><span className="li-title" style={{ display: 'block' }}>{d.insights.growingSite.name}</span></span>
                <ChevronLeft size={16} className="muted" />
              </button>
            )}
            {d.insights.needsCheck && (
              <button className="li clickable" style={{ width: '100%', textAlign: 'start' }} onClick={() => onSelect(d.insights.needsCheck!.id)}>
                <span className="li-icon" style={{ color: 'var(--warn)', background: 'var(--warn-bg)' }}><AlertTriangle size={16} /></span>
                <span className="li-main"><span className="li-meta">שווה בדיקה</span><span className="li-title" style={{ display: 'block' }}>{d.insights.needsCheck.name}</span></span>
                <ChevronLeft size={16} className="muted" />
              </button>
            )}
            {d.insights.peakHour && (
              <div className="li">
                <span className="li-icon"><Clock size={16} /></span>
                <div className="li-main"><div className="li-meta">שעת השיא</div><div className="li-title ltr" style={{ textAlign: 'right' }}>{d.insights.peakHour}</div></div>
              </div>
            )}
            {d.insights.topSource && (
              <div className="li">
                <span className="li-icon"><Link2 size={16} /></span>
                <div className="li-main"><div className="li-meta">המקור המוביל</div><div className="li-title"><bdi>{d.insights.topSource}</bdi></div></div>
              </div>
            )}
            {d.insights.topPage && (
              <button className="li clickable" style={{ width: '100%', textAlign: 'start' }} onClick={() => onSelect(d.insights.topPage!.siteId)}>
                <span className="li-icon"><FileText size={16} /></span>
                <span className="li-main">
                  <span className="li-meta">הדף הכי נקרא</span>
                  <span className="li-title" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.insights.topPage.title}</span>
                </span>
                <ChevronLeft size={16} className="muted" />
              </button>
            )}
            {d.insights.mobilePct != null && (
              <div className="li">
                <span className="li-icon"><Smartphone size={16} /></span>
                <div className="li-main"><div className="li-meta">גלישה מהנייד</div><div className="li-title num">{pct0(d.insights.mobilePct)}</div></div>
              </div>
            )}
          </div>
        ) : (
          <Empty icon={Sparkles} title="אין תובנות עדיין" text="יופיעו לאחר כניסות ראשונות לאתרים." />
        )}
      </Card>

      {/* All Sites Grid */}
      <div className="lg-12 card-head" style={{ marginBottom: -4, marginTop: 6 }}>
        <div><h2>כל האתרים</h2><div className="sub">לחץ על אתר כדי להיכנס לנתונים, המרות וקוד ההטמעה שלו</div></div>
      </div>

      {d.sites.map((s) => {
        const rec = sites.find((m) => m.id === s.id);
        return (
          <Card key={s.id} className="lg-6 md-6" onClick={() => onSelect(s.id)}>
            <div className="spread" style={{ alignItems: 'flex-start', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <b style={{ fontWeight: 500, fontSize: 17, display: 'block' }}>{s.name}</b>
                <span className="meta ltr" style={{ display: 'inline-block' }}>{s.domain || 'דומיין יילמד בכניסה הראשונה'}</span>
              </div>
              <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                {s.online > 0 ? (
                  <Badge kind="pos" icon={false}>
                    <span className="row" style={{ gap: 5 }}>
                      <span className="pulse" style={{ width: 6, height: 6, background: 'var(--pos)' }} />
                      {s.online} עכשיו
                    </span>
                  </Badge>
                ) : (
                  <Badge icon={false}>אין כרגע</Badge>
                )}
                {rec && (
                  <button
                    type="button"
                    className="icon-btn bare"
                    title="קוד הטמעה"
                    aria-label={`קוד הטמעה עבור ${s.name}`}
                    onClick={(e) => { e.stopPropagation(); onOpenCode(rec); }}
                  >
                    <Code2 size={15} />
                  </button>
                )}
              </div>
            </div>

            <div className="spread" style={{ marginTop: 14, alignItems: 'flex-end', gap: 12 }}>
              <div>
                <div style={{ fontSize: 32, fontWeight: 500, lineHeight: 1.1, letterSpacing: '-0.03em' }} className="num">
                  {s.hasData ? cnt(s.visitors) : '—'}
                </div>
                <div className="row meta" style={{ marginTop: 4, gap: 6 }}>
                  <span>{s.hasData ? 'מבקרים' : 'אין נתונים עדיין'}</span>
                  {s.hasData && <Delta value={s.visitorsDelta} />}
                </div>
              </div>
              {s.spark.length > 1 && <Spark values={s.spark} width={118} height={34} />}
            </div>

            <div className="row wrap meta" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', gap: 12 }}>
              <span><b style={{ color: 'var(--ink)', fontWeight: 500 }}>{cnt(s.todayVisitors)}</b> היום</span>
              <span><b style={{ color: 'var(--ink)', fontWeight: 500 }}>{cnt(s.views)}</b> צפיות</span>
              <span>{durHe(s.avgSec)}</span>
              <span>{pct0(s.bounceRate)} נטישה</span>
            </div>
          </Card>
        );
      })}

      {/* Add Site Card */}
      <Card
        className="soft lg-6 md-6"
        onClick={onNewSite}
        style={{ display: 'grid', placeItems: 'center', minHeight: 170, borderStyle: 'dashed' }}
      >
        <div className="stack" style={{ alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <span className="li-icon" style={{ background: 'var(--surface)' }}><Plus size={20} /></span>
          <b style={{ fontWeight: 500 }}>הוספת אתר</b>
          <span className="meta">קבלת קוד הטמעה למעקב תנועה והמרות</span>
        </div>
      </Card>

      {/* Site Ranking + Live Feed */}
      <Card className="flush lg-5 md-12">
        <div className="card-head" style={{ padding: '20px 20px 8px', marginBottom: 0, flexWrap: 'wrap', gap: 8 }}>
          <h2>דירוג האתרים</h2>
          <PillTabs
            id="rank-tab"
            value={rankTab}
            onChange={setRankTab}
            items={[
              { value: 'now', label: 'עכשיו' },
              { value: 'today', label: 'היום' },
              { value: 'period', label: 'בתקופה' },
            ]}
          />
        </div>
        <div className="list">
          {rankList.map((s, idx) => {
            const share = rankTotal ? s.val / rankTotal : 0;
            return (
              <button key={s.id} className="li clickable" style={{ width: '100%', textAlign: 'start' }} onClick={() => onSelect(s.id)}>
                <span className="meta num" style={{ width: 18, flexShrink: 0 }}>{idx + 1}</span>
                <span className="li-main">
                  <span className="li-title" style={{ display: 'block' }}>{s.name}</span>
                  <span style={{ display: 'block', height: 4, borderRadius: 4, background: 'var(--surface-3)', marginTop: 6, overflow: 'hidden' }}>
                    <motion.i
                      style={{ display: 'block', height: '100%', background: SITE_PALETTE[idx % SITE_PALETTE.length], transformOrigin: 'right' }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: share }}
                      transition={{ duration: 0.45, ease: easeOut }}
                    />
                  </span>
                </span>
                <span className="li-end num">
                  <b style={{ fontWeight: 500 }}>{cnt(s.val)}</b>
                  {s.val > 0 && <span className="meta" style={{ marginInlineStart: 6 }}>{pct0(share)}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="flush lg-7 md-12">
        <div className="card-head" style={{ padding: '20px 20px 6px', marginBottom: 0 }}>
          <div><h2>מה קורה עכשיו</h2><div className="sub">כניסות אחרונות בזמן אמת מכל האתרים</div></div>
        </div>
        {d.liveFeed.length ? (
          <div className="list" style={{ maxHeight: 370, overflowY: 'auto' }}>
            {d.liveFeed.map((ev) => (
              <button key={ev.id} className="li clickable" style={{ width: '100%', textAlign: 'start' }} onClick={() => onSelect(ev.siteId)}>
                <span className="li-icon"><DeviceIcon kind={ev.device} /></span>
                <span className="li-main">
                  <span className="li-title" style={{ display: 'block' }} dir="auto">{ev.title}</span>
                  <span className="li-meta">
                    {ev.siteName} · <bdi className="ltr">{decodeSafe(ev.path)}</bdi>
                    {ev.source && <> · נכנס מ{ev.source === 'ישיר' ? 'ישיר' : `־${ev.source}`}</>}
                  </span>
                </span>
                <span className="meta" style={{ whiteSpace: 'nowrap' }}>
                  {ev.agoMin <= 1 ? 'עכשיו' : `לפני ${ev.agoMin} דק׳`}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <Empty icon={Activity} title="אין פעילות עדיין" text="ברגע שגולשים ייכנסו לאתרים שלך הם יופיעו כאן." />
        )}
      </Card>

      {/* Sources + Devices & Browsers */}
      <Card className="lg-6 md-12">
        <CardHead title="מאיפה מגיעים" sub="מבקרים לפי מקור הגעה" />
        {d.sources.length ? (
          <div className="stack" style={{ gap: 12 }}>
            {d.sources.map((s) => (
              <div key={s.name}>
                <div className="spread" style={{ fontSize: 14 }}>
                  <bdi style={{ fontWeight: 500 }}>{s.name}</bdi>
                  <span className="num"><b>{cnt(s.count)}</b> <span className="meta">· {pct0(s.pct)}</span></span>
                </div>
                <div style={{ height: 5, borderRadius: 5, background: 'var(--surface-3)', marginTop: 6, overflow: 'hidden' }}>
                  <motion.i
                    style={{ display: 'block', height: '100%', background: 'var(--ink)', transformOrigin: 'right' }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: s.count / maxSource }}
                    transition={{ duration: 0.45, ease: easeOut }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon={Link2} title="אין נתונים עדיין" />
        )}
      </Card>

      <Card className="lg-6 md-12">
        <CardHead title="מכשירים ודפדפנים" />
        {d.hasData ? (
          <div className="stack" style={{ gap: 20 }}>
            <DeviceDonut devices={d.devices} />
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              <div className="meta" style={{ marginBottom: 10 }}>דפדפנים</div>
              <div className="stack" style={{ gap: 8 }}>
                {d.browsers.slice(0, 6).map((b) => (
                  <div key={b.name} className="spread" style={{ fontSize: 14 }}>
                    <bdi>{b.name}</bdi>
                    <span className="num" style={{ fontWeight: 500 }}>{cnt(b.count)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <Empty icon={Smartphone} title="אין נתונים עדיין" />
        )}
      </Card>

      {/* Heatmap: When visitors arrive */}
      <Card className="lg-12">
        <CardHead title="מתי מבקרים" sub="חלוקת ביקורים לפי יום בשבוע ושעה (שעון ישראל)" />
        {d.hasData ? <VisitHeatmap grid={d.heatmap} /> : <Empty icon={Clock} title="אין נתונים עדיין" />}
      </Card>

      {/* Top Pages across all sites */}
      <Card className="flush lg-12">
        <div className="card-head" style={{ padding: '20px 20px 6px', marginBottom: 0 }}>
          <div><h2>הדפים הכי נקראים</h2><div className="sub">בכל האתרים יחד</div></div>
        </div>
        {d.topPages.length ? (
          <div className="list">
            {d.topPages.map((pg, i) => (
              <button key={`${pg.siteId}-${pg.path}`} className="li clickable" style={{ width: '100%', textAlign: 'start' }} onClick={() => onSelect(pg.siteId)}>
                <span className="meta num" style={{ width: 22, flexShrink: 0 }}>{i + 1}</span>
                <span className="li-main">
                  <span className="li-title" style={{ display: 'block' }} dir="auto">{pg.title}</span>
                  <span className="li-meta">{pg.siteName} · <bdi className="ltr">{decodeSafe(pg.path)}</bdi></span>
                </span>
                <span className="li-end" style={{ textAlign: 'end' }}>
                  <div className="num" style={{ fontWeight: 500 }}>{cnt(pg.views)}</div>
                  <div className="meta">{durHe(pg.avgSec)}</div>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <Empty icon={FileText} title="אין נתונים עדיין" />
        )}
      </Card>
    </Stagger>
  );
}

/* ================= Single Site Detail (PDF #2) ================= */
function SiteDetailView({
  siteRec, days, onBack, onOpenCode,
}: {
  siteRec: any;
  days: number;
  onBack: () => void;
  onOpenCode: () => void;
}) {
  const toast = useToast();
  const crud = useCrud('monitors');
  const [convSheet, setConvSheet] = useState<{ open: boolean; edit?: SiteConversion; presetType?: SiteConversion['type'] }>({ open: false });
  const [logOpen, setLogOpen] = useState(false);

  const r = useApiData<SiteDetailReport>(
    `/api/marketing?source=site_detail&id=${siteRec.id}&days=${days}`,
    () => demoSiteDetail(siteRec, days),
    [siteRec.id, days, (siteRec.conversions || []).length],
  );

  const liveRec = siteRec;
  const domain = cleanDomain(liveRec.domain || liveRec.url);
  const siteUrl = liveRec.url || (domain ? `https://${domain}` : '');
  const debugUrl = siteUrl ? `${siteUrl.replace(/\/$/, '')}/?gd_debug=1` : '';

  const saveConversion = (conv: SiteConversion) => {
    const prev: SiteConversion[] = Array.isArray(liveRec.conversions) ? liveRec.conversions : [];
    const exists = prev.some((c) => c.id === conv.id);
    const next = exists ? prev.map((c) => (c.id === conv.id ? conv : c)) : [...prev, conv];
    store.update('monitors', liveRec.id, { conversions: next });
    toast(exists ? 'ההמרה עודכנה' : 'המרה נוספה לאתר');
    setConvSheet({ open: false });
    setTimeout(r.reload, 250);
  };

  const deleteConversion = (id: string) => {
    const prev: SiteConversion[] = Array.isArray(liveRec.conversions) ? liveRec.conversions : [];
    store.update('monitors', liveRec.id, { conversions: prev.filter((c) => c.id !== id) });
    toast('ההמרה הוסרה');
    setConvSheet({ open: false });
    setTimeout(r.reload, 250);
  };

  const toggleShared = () => {
    const next = !liveRec.shared;
    store.update('monitors', liveRec.id, { shared: next });
    if (next && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(location.href).catch(() => null);
      toast('האתר מסומן כמשותף · הקישור הועתק');
    } else {
      toast(next ? 'האתר מסומן כמשותף' : 'השיתוף בוטל');
    }
  };

  if (r.loading && !r.data) return <SitesLoading />;
  if (r.error) return <SitesError text={r.error} onRetry={r.reload} />;
  const d = r.data!;

  // Merge stored conversions with counts from report
  const convList: SiteConversion[] = (Array.isArray(liveRec.conversions) ? liveRec.conversions : d.conversions).map((c: SiteConversion) => {
    const stats = d.conversions.find((x) => x.id === c.id);
    return { ...c, total30d: stats?.total30d ?? c.total30d ?? 0, fromAds30d: stats?.fromAds30d ?? c.fromAds30d ?? 0, sentToGoogle30d: stats?.sentToGoogle30d ?? c.sentToGoogle30d ?? 0 };
  });

  const maxSource = Math.max(1, ...d.sources.map((s) => s.count));
  const sc = d.google?.search;

  return (
    <Stagger>
      {/* Action bar */}
      <div className="lg-12 spread wrap" style={{ gap: 10 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowRight size={15} />כל האתרים
        </button>
        <div className="row wrap" style={{ gap: 8 }}>
          {siteUrl && (
            <a className="btn btn-soft btn-sm" href={siteUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />לאתר
            </a>
          )}
          <button className="btn btn-soft btn-sm" onClick={onOpenCode}><Code2 size={14} />קוד הטמעה</button>
          <button className="btn btn-soft btn-sm" onClick={() => crud.openEdit(liveRec)}><Pencil size={14} />עריכה</button>
          <button className={`btn btn-sm ${liveRec.shared ? 'btn-primary' : 'btn-soft'}`} onClick={toggleShared}>
            <Share2 size={14} />{liveRec.shared ? 'משותף' : 'שיתוף'}
          </button>
        </div>
      </div>

      {/* Site Header + Online Hero */}
      <Card className="hero hero-slate lg-12" style={{ minHeight: 0 }}>
        <div className="spread wrap" style={{ gap: 16, alignItems: 'center' }}>
          <div style={{ textAlign: 'start' }}>
            <div className="meta ltr" style={{ opacity: 0.85, color: 'inherit', marginBottom: 4 }}>{domain || 'ממתין לדומיין'}</div>
            <h2 style={{ fontSize: 28, fontWeight: 500, margin: 0 }}>{liveRec.name}</h2>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40, fontWeight: 500, lineHeight: 1 }} className="num">{cnt(d.online)}</div>
              <div className="row" style={{ gap: 6, justifyContent: 'center', marginTop: 4, fontSize: 13, opacity: 0.9 }}>
                <span className="pulse" style={{ width: 7, height: 7, background: d.online > 0 ? 'var(--lime)' : 'currentColor' }} />
                מחוברים עכשיו
              </div>
            </div>
          </div>
        </div>
      </Card>

      {!d.hasData && !DEMO && (
        <Card className="soft lg-12">
          <div className="spread wrap" style={{ gap: 12 }}>
            <div>
              <b style={{ fontWeight: 500, display: 'block' }}>עדיין לא הגיעו כניסות מהאתר הזה</b>
              <span className="meta">הדבק את קוד ההטמעה באתר ותוך שניות תתחיל לראות מבקרים, עמודים והמרות בזמן אמת.</span>
            </div>
            <button className="btn btn-primary btn-sm" onClick={onOpenCode}><Code2 size={14} />קבלת קוד הטמעה</button>
          </div>
        </Card>
      )}

      {/* Conversions Card */}
      <Card className="flush lg-12">
        <div className="card-head" style={{ padding: '20px 20px 8px', marginBottom: 0 }}>
          <div><h2>המרות באתר</h2><div className="sub">מעקב טפסים, וואטסאפ, טלפון, כפתורים ועמודי תודה</div></div>
        </div>

        {convList.length > 0 ? (
          <div className="list">
            {convList.map((c) => {
              const meta = CONV_TYPES.find((t) => t.value === c.type) ?? CONV_TYPES[0];
              const Icon = meta.icon;
              return (
                <button
                  key={c.id}
                  className="li clickable"
                  style={{ width: '100%', textAlign: 'start', alignItems: 'flex-start', paddingBlock: 14 }}
                  onClick={() => setConvSheet({ open: true, edit: c })}
                >
                  <span className="li-icon"><Icon size={17} /></span>
                  <span className="li-main">
                    <span className="li-title" style={{ display: 'block' }}>{c.name}</span>
                    <span className="li-meta">
                      {meta.prefix}: <bdi className="ltr">{c.selector || 'אוטומטי'}</bdi>
                    </span>
                    <span className="chips" style={{ marginTop: 6 }}>
                      {c.primary && <Badge icon={false}>ראשית</Badge>}
                      {c.google_ads && <Badge kind="pos" icon={false}>מחובר ל־Google Ads</Badge>}
                      {c.value != null && c.value > 0 && <Badge icon={false}>₪{cnt(c.value)}</Badge>}
                    </span>
                  </span>
                  <span className="li-end" style={{ textAlign: 'end', flexShrink: 0 }}>
                    <div className="num" style={{ fontSize: 20, fontWeight: 500 }}>{cnt(c.total30d ?? 0)}</div>
                    <div className="meta">
                      ב־30 יום{c.fromAds30d ? ` · ${cnt(c.fromAds30d)} ממודעות` : ''}{c.sentToGoogle30d ? ` · ${cnt(c.sentToGoogle30d)} נשלחו ל־Google` : ''}
                    </div>
                    {c.last_tested_at && (
                      <div className="meta" style={{ marginTop: 2 }}>
                        נבדק {shortDate(c.last_tested_at.slice(0, 10))} {c.last_tested_at.slice(11, 16)}
                      </div>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: '12px 20px 4px' }} className="meta">עדיין לא הוגדרו המרות לאתר הזה. בחר סוג המרה למטה כדי להוסיף.</div>
        )}

        {/* Quick add conversion buttons */}
        <div className="chips" style={{ padding: '14px 20px', borderTop: '1px solid var(--line)', gap: 8 }}>
          {CONV_TYPES.map((t) => (
            <button key={t.value} className="chip" onClick={() => setConvSheet({ open: true, presetType: t.value })}>
              <Plus size={13} />{t.label}
            </button>
          ))}
        </div>

        {/* Google Ads log + Debug mode instructions */}
        <div style={{ padding: '12px 20px 18px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)' }}>
          <button
            type="button"
            className="row"
            style={{ gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}
            onClick={() => setLogOpen((o) => !o)}
          >
            <ChevronDown size={15} style={{ transform: logOpen ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 160ms' }} />
            יומן שליחה ל־Google ({d.googleLog.length})
          </button>
          {logOpen && (
            <div style={{ marginTop: 10 }}>
              {d.googleLog.length ? (
                <div className="stack" style={{ gap: 6 }}>
                  {d.googleLog.slice(0, 8).map((g) => (
                    <div key={g.id} className="spread meta" style={{ fontSize: 12.5, padding: '6px 10px', background: 'var(--surface)', borderRadius: 10 }}>
                      <span><b style={{ color: 'var(--ink)', fontWeight: 500 }}>{g.name}</b> · <bdi className="ltr">{g.path}</bdi></span>
                      <span className="row" style={{ gap: 8 }}>
                        {g.value ? <span>₪{cnt(g.value)}</span> : null}
                        <Badge kind={g.sent ? 'pos' : 'none'} icon={false}>{g.sent ? 'נשלח' : 'ממתין'}</Badge>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="meta" style={{ margin: '6px 0 0' }}>אין עדיין אירועי המרה ממודעות Google בטווח הזה.</p>
              )}
            </div>
          )}

          <p className="meta" style={{ margin: '12px 0 0', lineHeight: 1.6 }}>
            <b>בדיקה:</b>{' '}
            {debugUrl ? (
              <a href={debugUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'var(--ink)' }}>
                פתיחת האתר במצב בדיקה
              </a>
            ) : (
              <span>פתיחת האתר במצב בדיקה</span>
            )}{' '}
            — כל המרה שמזוהה מוצגת בתחתית המסך ולא נספרת. לסיום: <bdi className="ltr">?gd_debug=0</bdi>
          </p>
        </div>
      </Card>

      {/* 7 Site KPIs */}
      <Card className="lg-3 md-6 sm-6"><Kpi label="מבקרים" icon={Users} value={d.hasData ? cnt(d.kpis.visitors) : '—'} delta={d.hasData ? d.kpis.visitorsDelta : null} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="צפיות בדפים" icon={Eye} value={d.hasData ? cnt(d.kpis.views) : '—'} delta={d.hasData ? d.kpis.viewsDelta : null} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="ביקורים" icon={Activity} value={d.hasData ? cnt(d.kpis.visits) : '—'} delta={d.hasData ? d.kpis.visitsDelta : null} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="זמן ממוצע לביקור" icon={Clock} value={d.hasData ? durHe(d.kpis.avgSec) : '—'} /></Card>
      <Card className="lg-4 md-4 sm-6"><Kpi label="דפים לביקור" value={d.hasData ? d.kpis.pagesPerVisit.toFixed(1) : '—'} /></Card>
      <Card className="lg-4 md-4 sm-6"><Kpi label="נטישה (דף אחד)" value={d.hasData ? pct0(d.kpis.bounceRate) : '—'} /></Card>
      <Card className="lg-4 md-4 sm-6"><Kpi label="מבקרים חדשים" value={d.hasData ? pct0(d.kpis.newRate) : '—'} /></Card>

      {/* Visitors in period + Today by hour */}
      <Card className="lg-6 md-12">
        <CardHead title="מבקרים בתקופה" sub={`${days} ימים אחרונים`} />
        {d.hasData ? <SimpleDailyChart data={d.daily} /> : <Empty icon={BarChart3} title="אין נתונים עדיין" />}
      </Card>
      <Card className="lg-6 md-12">
        <CardHead title="היום לפי שעה" sub="0:00 עד 23:00 (שעון ישראל)" />
        {d.hasData ? <HourlyChart data={d.hourlyToday} /> : <Empty icon={Clock} title="אין נתונים עדיין" />}
      </Card>

      {/* Top pages table */}
      <Card className="flush lg-12">
        <div className="card-head" style={{ padding: '20px 20px 6px', marginBottom: 0 }}>
          <h2>הדפים המובילים</h2>
        </div>
        {d.topPages.length ? (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>דף</th>
                  <th className="num">צפיות</th>
                  <th className="num">מבקרים</th>
                  <th className="num">זמן</th>
                </tr>
              </thead>
              <tbody>
                {d.topPages.map((pg) => (
                  <tr key={pg.path}>
                    <td>
                      <div style={{ fontWeight: 500 }} dir="auto">{pg.title}</div>
                      <div className="meta ltr" style={{ display: 'inline-block' }}>{decodeSafe(pg.path)}</div>
                    </td>
                    <td className="num">{cnt(pg.views)}</td>
                    <td className="num">{cnt(pg.visitors)}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{durHe(pg.avgSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={FileText} title="אין נתונים עדיין" />
        )}
      </Card>

      {/* Where they are now + Top landing pages */}
      <Card className="flush lg-6 md-12">
        <div className="card-head" style={{ padding: '20px 20px 6px', marginBottom: 0 }}>
          <div><h2>איפה הם עכשיו</h2><div className="sub">דפים פעילים ב־5 הדקות האחרונות</div></div>
        </div>
        {d.onlinePages.length ? (
          <div className="list">
            {d.onlinePages.map((p) => (
              <div key={p.path} className="li">
                <div className="li-main">
                  <div className="li-title" dir="auto">{p.title}</div>
                  <div className="li-meta ltr" style={{ display: 'inline-block' }}>{decodeSafe(p.path)}</div>
                </div>
                <Badge kind="pos" icon={false}>{cnt(p.count)}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon={Users} title="אין גולשים פעילים כרגע" />
        )}
      </Card>

      <Card className="flush lg-6 md-12">
        <div className="card-head" style={{ padding: '20px 20px 6px', marginBottom: 0 }}>
          <div><h2>דפי כניסה מובילים בתקופה</h2><div className="sub">הדף הראשון שבו התחיל הביקור</div></div>
        </div>
        {d.landingPages.length ? (
          <div className="list">
            {d.landingPages.map((lp) => (
              <div key={lp.path} className="li">
                <div className="li-main li-title"><bdi className="ltr">{decodeSafe(lp.path)}</bdi></div>
                <div className="li-end num" style={{ fontWeight: 500 }}>{cnt(lp.count)}</div>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon={Globe} title="אין נתונים עדיין" />
        )}
      </Card>

      {/* Sources + Devices/Browsers + Countries */}
      <Card className="lg-4 md-12">
        <CardHead title="מאיפה הגיעו" />
        {d.sources.length ? (
          <div className="stack" style={{ gap: 10 }}>
            {d.sources.map((s) => (
              <div key={s.name}>
                <div className="spread" style={{ fontSize: 14 }}><bdi>{s.name}</bdi><span className="num" style={{ fontWeight: 500 }}>{cnt(s.count)}</span></div>
                <div style={{ height: 4, borderRadius: 4, background: 'var(--surface-3)', marginTop: 5, overflow: 'hidden' }}>
                  <motion.i style={{ display: 'block', height: '100%', background: 'var(--ink)', transformOrigin: 'right' }} initial={{ scaleX: 0 }} animate={{ scaleX: s.count / maxSource }} transition={{ duration: 0.4, ease: easeOut }} />
                </div>
              </div>
            ))}
          </div>
        ) : <Empty icon={Link2} title="אין נתונים עדיין" />}
      </Card>

      <Card className="lg-4 md-12">
        <CardHead title="מכשירים ודפדפנים" />
        {d.hasData ? (
          <div className="stack" style={{ gap: 12 }}>
            {d.devices.map((dev) => (
              <div key={dev.kind} className="spread" style={{ fontSize: 14 }}>
                <span className="row" style={{ gap: 8 }}>
                  <DeviceIcon kind={dev.kind} size={15} />
                  {dev.kind === 'mobile' ? 'נייד' : dev.kind === 'desktop' ? 'מחשב' : 'טאבלט'}
                </span>
                <span className="num" style={{ fontWeight: 500 }}>{pct0(dev.pct)}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 4 }}>
              <div className="meta" style={{ marginBottom: 8 }}>דפדפנים</div>
              <div className="stack" style={{ gap: 6 }}>
                {d.browsers.slice(0, 6).map((b) => (
                  <div key={b.name} className="spread" style={{ fontSize: 13.5 }}><bdi>{b.name}</bdi><span className="num">{cnt(b.count)}</span></div>
                ))}
              </div>
            </div>
          </div>
        ) : <Empty icon={Smartphone} title="אין נתונים עדיין" />}
      </Card>

      <Card className="lg-4 md-12">
        <CardHead title="מדינות" />
        {d.countries.length ? (
          <div className="stack" style={{ gap: 8 }}>
            {d.countries.map((c) => (
              <div key={c.name} className="spread" style={{ fontSize: 14 }}>
                <span>{c.name}</span>
                <span className="num" style={{ fontWeight: 500 }}>{cnt(c.count)}</span>
              </div>
            ))}
          </div>
        ) : <Empty icon={Globe} title="אין נתונים עדיין" />}
      </Card>

      {/* Optional Google Search Console section when connected */}
      {sc && (
        <Card className="flush lg-12">
          <div className="card-head" style={{ padding: '20px 20px 8px', marginBottom: 0 }}>
            <div>
              <h2>חיפוש בגוגל · Search Console</h2>
              <div className="sub">{cnt(sc.clicks)} קליקים · {cnt(sc.impressions)} הופעות · מיקום ממוצע {sc.position.toFixed(1)} · CTR {(sc.ctr * 100).toFixed(1)}%</div>
            </div>
          </div>
          {sc.queries.length ? (
            <div className="list">
              {sc.queries.map((q) => (
                <div key={q.q} className="li">
                  <span className="li-icon"><Search size={15} /></span>
                  <div className="li-main"><div className="li-title" dir="auto">{q.q}</div><div className="li-meta">{cnt(q.impressions)} הופעות</div></div>
                  <div className="li-end num" style={{ fontWeight: 500 }}>{cnt(q.clicks)} קליקים</div>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={Search} title="אין שאילתות חיפוש בטווח" />
          )}
        </Card>
      )}

      {crud.sheet}
      <ConversionSheet
        open={convSheet.open}
        initial={convSheet.edit}
        presetType={convSheet.presetType}
        onClose={() => setConvSheet({ open: false })}
        onSave={saveConversion}
        onDelete={convSheet.edit ? () => deleteConversion(convSheet.edit!.id) : undefined}
      />
    </Stagger>
  );
}

/* ================= Charts ================= */
function StackedSitesChart({ trend }: { trend: PortfolioReport['trend'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 200, padB = 24, padT = 12;
  const max = Math.max(1, ...trend.days.map((d) => d.total));
  const slot = W / Math.max(1, trend.days.length);
  const bw = Math.max(3, Math.min(20, slot * 0.68));
  const h = (v: number) => ((H - padB - padT) * v) / max;
  const curIdx = hover ?? trend.days.length - 1;
  const cd = trend.days[curIdx];
  const labelEvery = Math.max(1, Math.ceil(trend.days.length / 7));
  const avgY = H - padB - h(trend.avgPerDay);

  return (
    <div>
      <div className="spread wrap" style={{ marginBottom: 10, gap: 8 }}>
        <div className="legend">
          {trend.shares.map((s, idx) => (
            <span key={s.id}>
              <i style={{ background: SITE_PALETTE[idx % SITE_PALETTE.length] }} />
              {s.name} <b className="num" style={{ fontWeight: 500 }}>{pct0(s.pct)}</b>
            </span>
          ))}
        </div>
        {cd && <div className="meta num" aria-live="polite">{shortDate(cd.day)} · {cnt(cd.total)} מבקרים</div>}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="מגמת תנועה לפי אתר" style={{ direction: 'ltr' }}>
        {[0.5, 1].map((t) => (
          <line key={t} x1="0" x2={W} y1={H - padB - h(max * t)} y2={H - padB - h(max * t)} stroke="var(--line)" strokeDasharray="2 5" />
        ))}
        {trend.avgPerDay > 0 && (
          <line x1="0" x2={W} y1={avgY} y2={avgY} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
        )}
        {trend.days.map((d, k) => {
          const cx = W - (slot * k + slot / 2);
          let yOff = H - padB;
          return (
            <g key={d.day} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} onTouchStart={() => setHover(k)} opacity={hover == null || hover === k ? 1 : 0.45}>
              <rect x={cx - slot / 2} y="0" width={slot} height={H} fill="transparent" />
              <motion.g style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.45, ease: easeOut, delay: Math.min(0.25, k * 0.006) }}>
                {trend.shares.map((sh, sIdx) => {
                  const v = d.bySite[sh.id] ?? 0;
                  if (!v) return null;
                  const bh = h(v);
                  yOff -= bh;
                  return <rect key={sh.id} x={cx - bw / 2} y={yOff} width={bw} height={bh} rx={Math.min(3, bw / 3)} fill={SITE_PALETTE[sIdx % SITE_PALETTE.length]} />;
                })}
              </motion.g>
              {(trend.days.length - 1 - k) % labelEvery === 0 && (
                <text x={cx} y={H - 5} textAnchor="middle">{d.day.slice(8, 10)}.{d.day.slice(5, 7)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SimpleDailyChart({ data }: { data: { day: string; visitors: number; views: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 520, H = 170, padB = 22, padT = 10;
  const max = Math.max(1, ...data.map((d) => d.visitors));
  const slot = W / Math.max(1, data.length);
  const bw = Math.max(3, Math.min(16, slot * 0.65));
  const h = (v: number) => ((H - padB - padT) * v) / max;
  const cur = data[hover ?? data.length - 1];
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  return (
    <div>
      {cur && <div className="meta num" style={{ marginBottom: 8, textAlign: 'end' }}>{shortDate(cur.day)} · {cnt(cur.visitors)} מבקרים · {cnt(cur.views)} צפיות</div>}
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="מבקרים בתקופה" style={{ direction: 'ltr' }}>
        {[0.5, 1].map((t) => <line key={t} x1="0" x2={W} y1={H - padB - h(max * t)} y2={H - padB - h(max * t)} stroke="var(--line)" strokeDasharray="2 5" />)}
        {data.map((d, k) => {
          const cx = W - (slot * k + slot / 2);
          const bh = h(d.visitors);
          return (
            <g key={d.day} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} onTouchStart={() => setHover(k)} opacity={hover == null || hover === k ? 1 : 0.45}>
              <rect x={cx - slot / 2} y="0" width={slot} height={H} fill="transparent" />
              <motion.rect x={cx - bw / 2} y={H - padB - bh} width={bw} height={bh} rx={3} fill="var(--chart-1)" style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.4, ease: easeOut }} />
              {(data.length - 1 - k) % labelEvery === 0 && <text x={cx} y={H - 5} textAnchor="middle">{d.day.slice(8, 10)}.{d.day.slice(5, 7)}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function HourlyChart({ data }: { data: { hour: number; visitors: number; views: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 520, H = 170, padB = 22, padT = 10;
  const max = Math.max(1, ...data.map((d) => d.visitors));
  const slot = W / 24;
  const bw = Math.max(4, slot * 0.62);
  const h = (v: number) => ((H - padB - padT) * v) / max;
  const cur = hover != null ? data[hover] : null;
  return (
    <div>
      <div className="meta num" style={{ marginBottom: 8, textAlign: 'end', minHeight: 18 }}>
        {cur ? `${String(cur.hour).padStart(2, '0')}:00 · ${cnt(cur.visitors)} מבקרים · ${cnt(cur.views)} צפיות` : 'עבור על שעה לפירוט'}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="מבקרים היום לפי שעה" style={{ direction: 'ltr' }}>
        {[0.5, 1].map((t) => <line key={t} x1="0" x2={W} y1={H - padB - h(max * t)} y2={H - padB - h(max * t)} stroke="var(--line)" strokeDasharray="2 5" />)}
        {data.map((d, k) => {
          const cx = slot * k + slot / 2;
          const bh = h(d.visitors);
          return (
            <g key={d.hour} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} onTouchStart={() => setHover(k)} opacity={hover == null || hover === k ? 1 : 0.45}>
              <rect x={cx - slot / 2} y="0" width={slot} height={H} fill="transparent" />
              <motion.rect x={cx - bw / 2} y={H - padB - bh} width={bw} height={bh} rx={3} fill="var(--cobalt, #3340D6)" style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.4, ease: easeOut }} />
              {d.hour % 6 === 0 && <text x={cx} y={H - 5} textAnchor="middle">{d.hour}:00</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function DeviceDonut({ devices }: { devices: { kind: 'mobile' | 'desktop' | 'tablet'; count: number; pct: number }[] }) {
  const colors = { mobile: 'var(--ink)', desktop: 'var(--slate, #5F8A99)', tablet: '#D64C86' };
  const labels = { mobile: 'נייד', desktop: 'מחשב', tablet: 'טאבלט' };
  const R = 42, C = 2 * Math.PI * R;
  let offset = 0;
  const mobile = devices.find((d) => d.kind === 'mobile');
  return (
    <div className="row wrap" style={{ gap: 20, alignItems: 'center' }}>
      <svg width="112" height="112" viewBox="0 0 112 112" aria-label={`נייד ${pct0(mobile?.pct ?? 0)}`} style={{ flexShrink: 0 }}>
        <circle cx="56" cy="56" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="14" />
        {devices.map((d) => {
          const len = C * d.pct;
          const dash = `${Math.max(0, len - 2)} ${C}`;
          const el = (
            <circle
              key={d.kind}
              cx="56" cy="56" r={R}
              fill="none"
              stroke={colors[d.kind]}
              strokeWidth="14"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              transform="rotate(-90 56 56)"
            />
          );
          offset += len;
          return el;
        })}
        <text x="56" y="54" textAnchor="middle" fill="var(--ink)" fontSize="18" fontWeight="600">{pct0(mobile?.pct ?? 0)}</text>
        <text x="56" y="70" textAnchor="middle" fill="var(--ink-3)" fontSize="11">נייד</text>
      </svg>
      <div className="stack grow" style={{ gap: 10, minWidth: 160 }}>
        {devices.map((d) => (
          <div key={d.kind} className="spread" style={{ fontSize: 14 }}>
            <span className="row" style={{ gap: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: colors[d.kind], display: 'inline-block' }} />
              <DeviceIcon kind={d.kind} size={15} />
              <span><b>{labels[d.kind]}</b> <span className="meta">· {cnt(d.count)} מבקרים</span></span>
            </span>
            <span className="num" style={{ fontWeight: 500 }}>{pct0(d.pct)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VisitHeatmap({ grid }: { grid: number[][] }) {
  const [cell, setCell] = useState<{ d: number; h: number; v: number } | null>(null);
  const max = Math.max(1, ...grid.flat());
  return (
    <div>
      <div className="scroll-x">
        <div style={{ minWidth: 520 }}>
          {grid.map((row, dIdx) => (
            <div key={dIdx} style={{ display: 'grid', gridTemplateColumns: '26px repeat(24, minmax(0, 1fr))', gap: 3, alignItems: 'center', marginBottom: 3 }}>
              <span className="meta" style={{ fontSize: 11 }}>{DAYS_HE[dIdx]}</span>
              {row.map((v, hIdx) => {
                const intensity = v / max;
                return (
                  <button
                    key={hIdx}
                    type="button"
                    aria-label={`יום ${DAYS_HE[dIdx]} שעה ${hIdx}:00 — ${v} צפיות`}
                    onMouseEnter={() => setCell({ d: dIdx, h: hIdx, v })}
                    onFocus={() => setCell({ d: dIdx, h: hIdx, v })}
                    style={{
                      height: 18,
                      borderRadius: 4,
                      background: v === 0 ? 'var(--surface-2)' : `color-mix(in srgb, var(--cobalt, #3340D6) ${Math.round(16 + intensity * 84)}%, var(--surface-2))`,
                      border: cell?.d === dIdx && cell?.h === hIdx ? '1.5px solid var(--ink)' : '1px solid transparent',
                    }}
                  />
                );
              })}
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '26px repeat(4, 1fr)', marginTop: 6 }} className="meta">
            <span />
            <span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span>
          </div>
        </div>
      </div>
      <div className="spread wrap meta" style={{ marginTop: 10, gap: 8 }}>
        <span>{cell ? `יום ${DAYS_HE[cell.d]} · ${String(cell.h).padStart(2, '0')}:00–${String((cell.h + 1) % 24).padStart(2, '0')}:00 · ${cnt(cell.v)} צפיות` : 'עבור על תא כדי לראות פירוט'}</span>
        <span className="row" style={{ gap: 4 }}>
          <span>פחות</span>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <i key={t} style={{ width: 11, height: 11, borderRadius: 3, display: 'inline-block', background: t === 0 ? 'var(--surface-2)' : `color-mix(in srgb, var(--cobalt, #3340D6) ${Math.round(16 + t * 84)}%, var(--surface-2))` }} />
          ))}
          <span>יותר</span>
        </span>
      </div>
    </div>
  );
}

/* ================= Sheets (New Site, Embed Code, Conversion) ================= */
function NewSiteSheet({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (rec: { id: string; name: string; domain: string; url: string; site_key: string }) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [owner, setOwner] = useState('');
  const [ga, setGa] = useState('');
  const [adv, setAdv] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) { setName(''); setDomain(''); setOwner(''); setGa(''); setAdv(false); setErr(''); }
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr('יש להזין שם אתר'); return; }
    const dom = cleanDomain(domain);
    const url = dom ? `https://${dom}` : '';
    const site_key = makeSiteKey();
    const rec = store.add('monitors', {
      name: name.trim(),
      domain: dom,
      url,
      kind: 'אתר',
      owner: owner.trim(),
      site_key,
      ga_property: ga.trim() || undefined,
      conversions: [],
      history: [],
    });
    toast('האתר נוצר · קוד ההטמעה מוכן');
    onCreated({ id: rec.id, name: name.trim(), domain: dom, url, site_key });
  };

  return (
    <Sheet open={open} onClose={onClose} title="אתר חדש">
      <form onSubmit={submit} style={{ display: 'contents' }} noValidate>
        <div className="sheet-body">
          <div className="form">
            <label className="field full">
              <span>שם האתר</span>
              <input
                className="input"
                dir="auto"
                placeholder="למשל: הבלוג של שובל"
                value={name}
                onChange={(e) => { setName(e.target.value); setErr(''); }}
              />
            </label>
            <label className="field full">
              <span>דומיין</span>
              <input
                className="input ltr"
                dir="ltr"
                style={{ textAlign: 'left' }}
                placeholder="example.co.il"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
              <small className="meta" style={{ marginTop: 4 }}>
                רק דפים מהדומיין הזה (ותתי־דומיינים) ייספרו. אפשר להשאיר ריק — יילמד מהכניסה הראשונה.
              </small>
            </label>

            <div className="field full">
              <button type="button" className="row meta" style={{ gap: 6 }} onClick={() => setAdv((v) => !v)}>
                <ChevronDown size={14} style={{ transform: adv ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 150ms' }} />
                אפשרויות נוספות (שיוך / Google Analytics)
              </button>
            </div>
            {adv && (
              <>
                <label className="field"><span>שייך ל</span><input className="input" dir="auto" placeholder="עדן, OSPA…" value={owner} onChange={(e) => setOwner(e.target.value)} /></label>
                <label className="field"><span>מזהה GA4 (אופציונלי)</span><input className="input ltr" dir="ltr" placeholder="123456789" value={ga} onChange={(e) => setGa(e.target.value)} /></label>
              </>
            )}
            {err && <small className="neg full" role="alert">{err}</small>}
          </div>
        </div>
        <div className="sheet-foot">
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button type="submit" className="btn btn-primary"><Code2 size={16} />יצירת אתר וקבלת קוד</button>
        </div>
      </form>
    </Sheet>
  );
}

function EmbedCodeSheet({
  site, onClose,
}: {
  site: { name: string; domain: string; url: string; site_key: string } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const code = site ? embedSnippet(site.site_key) : '';
  const debugUrl = site?.url ? `${site.url.replace(/\/$/, '')}/?gd_debug=1` : site?.domain ? `https://${site.domain}/?gd_debug=1` : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast('קוד ההטמעה הועתק');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('לא ניתן להעתיק אוטומטית — סמן והעתק ידנית');
    }
  };

  return (
    <Sheet open={!!site} onClose={onClose} title={site ? `קוד הטמעה · ${site.name}` : 'קוד הטמעה'}>
      <div className="sheet-body">
        <p style={{ marginTop: 0, fontSize: 14 }}>
          הדבק את שורת הקוד הבאה בתוך <bdi className="ltr">&lt;head&gt;</bdi> באתר שלך (או ב־WordPress / Elementor / Wix / Google Tag Manager):
        </p>
        <div className="code" style={{ userSelect: 'all', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{code}</div>
        <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
          <button className="btn btn-primary" onClick={() => void copy()}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'הועתק!' : 'העתקת קוד'}
          </button>
          {debugUrl && (
            <a className="btn btn-soft" href={debugUrl} target="_blank" rel="noreferrer">
              <Target size={15} />בדיקה באתר
            </a>
          )}
        </div>
        <p className="meta" style={{ marginTop: 16, lineHeight: 1.6 }}>
          • הקוד קל מאוד (~3KB), נטען אסינכרונית (<bdi className="ltr">defer</bdi>) ולא מאט את האתר.<br />
          • אוסף כניסות בזמן אמת, דפים, מקורות, מכשירים, דפדפנים וכל ההמרות שהגדרת.<br />
          • למצב בדיקה ללא ספירה, פתח את האתר עם <bdi className="ltr">?gd_debug=1</bdi>.
        </p>
      </div>
      <div className="sheet-foot">
        <span className="grow" />
        <button className="btn btn-ghost" onClick={onClose}>סגור</button>
      </div>
    </Sheet>
  );
}

function ConversionSheet({
  open, initial, presetType, onClose, onSave, onDelete,
}: {
  open: boolean;
  initial?: SiteConversion;
  presetType?: SiteConversion['type'];
  onClose: () => void;
  onSave: (c: SiteConversion) => void;
  onDelete?: () => void;
}) {
  const [type, setType] = useState<SiteConversion['type']>('form');
  const [name, setName] = useState('');
  const [selector, setSelector] = useState('');
  const [value, setValue] = useState('');
  const [primary, setPrimary] = useState(true);
  const [googleAds, setGoogleAds] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setType(initial.type);
      setName(initial.name);
      setSelector(initial.selector || '');
      setValue(initial.value != null ? String(initial.value) : '');
      setPrimary(!!initial.primary);
      setGoogleAds(!!initial.google_ads);
    } else {
      const t = presetType ?? 'form';
      setType(t);
      setName('');
      setSelector('');
      setValue('');
      setPrimary(true);
      setGoogleAds(false);
    }
    setErr('');
  }, [open, initial, presetType]);

  const meta = CONV_TYPES.find((t) => t.value === type) ?? CONV_TYPES[0];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr('יש להזין שם להמרה'); return; }
    if ((type === 'button' || type === 'page') && !selector.trim()) {
      setErr(type === 'page' ? 'יש להזין נתיב עמוד (למשל /thank-you/)' : 'יש להזין טקסט כפתור או בורר');
      return;
    }
    onSave({
      id: initial?.id ?? `cv_${uid().slice(0, 8)}`,
      name: name.trim(),
      type,
      selector: selector.trim(),
      primary,
      value: value.trim() ? Number(value) : undefined,
      google_ads: googleAds,
      last_tested_at: initial?.last_tested_at,
    });
  };

  return (
    <Sheet open={open} onClose={onClose} title={initial ? 'עריכת המרה' : 'המרה חדשה באתר'}>
      <form onSubmit={submit} style={{ display: 'contents' }} noValidate>
        <div className="sheet-body">
          <div className="form">
            <div className="field full">
              <span>סוג המרה</span>
              <div className="chips">
                {CONV_TYPES.map((t) => (
                  <button type="button" key={t.value} className="chip" aria-pressed={type === t.value} onClick={() => setType(t.value)}>
                    <t.icon size={13} />{t.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="field full">
              <span>שם ההמרה</span>
              <input className="input" dir="auto" placeholder="למשל: טופס לידים" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} />
            </label>
            <label className="field full">
              <span>זיהוי ({meta.prefix})</span>
              <input className="input" dir="auto" placeholder={meta.placeholder} value={selector} onChange={(e) => { setSelector(e.target.value); setErr(''); }} />
            </label>
            <label className="field">
              <span>ערך המרה (₪, אופציונלי)</span>
              <input className="input ltr" type="number" min="0" placeholder="25" value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
            <div className="field full">
              <label className="switch"><span>המרה ראשית</span><Toggle checked={primary} onChange={setPrimary} label="המרה ראשית" /></label>
            </div>
            <div className="field full">
              <label className="switch"><span>שליחה ודיווח ל־Google Ads</span><Toggle checked={googleAds} onChange={setGoogleAds} label="שליחה ל-Google Ads" /></label>
            </div>
            {err && <small className="neg full" role="alert">{err}</small>}
          </div>
        </div>
        <div className="sheet-foot">
          {onDelete && <button type="button" className="btn btn-danger" onClick={onDelete}><Trash2 size={15} />מחיקה</button>}
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button type="submit" className="btn btn-primary">שמירה</button>
        </div>
      </form>
    </Sheet>
  );
}

/* ================= Loading / Error ================= */
function SitesLoading() {
  return <div className="grid">{[5, 7, 4, 4, 4, 8, 4].map((w, i) => <div key={i} className={`card lg-${w} md-12 skeleton`} style={{ minHeight: i < 2 ? 210 : 120, opacity: 0.55 }} aria-busy="true" />)}</div>;
}
function SitesError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return <div className="grid"><Card className="lg-12"><Empty icon={AlertTriangle} title="לא הצלחנו לטעון" text={text} action={<button className="btn btn-soft" onClick={onRetry}><RefreshCw size={14} />נסה שוב</button>} /></Card></div>;
}

/* ================= Demo Data (demo mode only) ================= */
const dayIso = (back: number) => new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);

function demoPortfolio(storeSites: any[], days: number): PortfolioReport {
  const baseSites = storeSites.length
    ? storeSites.map((s, idx) => ({
        id: s.id,
        name: s.name,
        domain: cleanDomain(s.domain || s.url) || `site${idx + 1}.co.il`,
        url: s.url || '',
        owner: s.owner || '',
        site_key: s.site_key || makeSiteKey(),
        online: idx === 0 ? 6 : 0,
        visitors: idx === 0 ? 4258 : idx === 1 ? 565 : idx === 2 ? 400 : 0,
        visitorsDelta: idx === 0 ? 0.27 : idx === 1 ? 0.2 : idx === 2 ? 9.53 : -1,
        todayVisitors: idx === 0 ? 159 : idx === 1 ? 0 : idx === 2 ? 10 : 0,
        views: idx === 0 ? 7121 : idx === 1 ? 1005 : idx === 2 ? 959 : 0,
        avgSec: idx === 0 ? 114 : idx === 1 ? 137 : idx === 2 ? 207 : 0,
        bounceRate: idx === 0 ? 0.76 : idx === 1 ? 0.7 : idx === 2 ? 0.73 : 0,
        spark: Array.from({ length: 14 }, (_, i) => Math.max(0, Math.round((idx === 0 ? 140 : idx === 1 ? 35 : idx === 2 ? 25 : 0) * (0.7 + 0.4 * Math.sin(i + idx))))),
        conversionsCount: idx === 0 ? 471 : 12,
        hasData: idx < 3,
      }))
    : [];

  const totalV = baseSites.reduce((a, s) => a + s.visitors, 0) || 1;
  const trendDays = Array.from({ length: days }, (_, i) => {
    const day = dayIso(days - 1 - i);
    const bySite: Record<string, number> = {};
    let total = 0;
    baseSites.forEach((s, idx) => {
      const v = s.hasData ? Math.round((s.visitors / days) * (0.65 + 0.55 * Math.sin(i * 0.55 + idx) + (i === Math.floor(days / 2) ? 1.8 : 0))) : 0;
      if (v > 0) bySite[s.id] = v;
      total += v;
    });
    return { day, total, bySite };
  });

  const peak = trendDays.reduce((best, d) => (d.total > best.value ? { day: d.day, value: d.total } : best), { day: dayIso(0), value: 0 });
  const avgPerDay = Math.round(trendDays.reduce((a, d) => a + d.total, 0) / Math.max(1, trendDays.length));
  const heatmap = Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => Math.max(0, Math.round((h >= 9 && h <= 22 ? 45 : 8) * (0.5 + 0.6 * Math.sin((h - 11) * 0.35 + d))))),
  );

  return {
    hasData: baseSites.length > 0,
    range: { days, since: dayIso(days - 1), until: dayIso(0) },
    realtime: {
      online: baseSites.reduce((a, s) => a + s.online, 0),
      bySite: baseSites.filter((s) => s.online > 0).map((s) => ({ id: s.id, name: s.name, count: s.online })),
      perMinute: Array.from({ length: 30 }, (_, i) => (i % 4 === 0 ? 1 : i === 27 ? 2 : 0)),
      viewsLast30m: 7,
    },
    today: {
      visitors: 169, visitorsDelta: 0.9, views: 272, viewsDelta: 0.94,
      activeSites: baseSites.filter((s) => s.todayVisitors > 0).length, totalSites: baseSites.length,
    },
    kpis: {
      visitors: 5223, visitorsDelta: 0.13, views: 9085, viewsDelta: 0.06, visits: 5906, visitsDelta: 0.1,
      avgSec: 124, avgSecDelta: 0.14, bounceRate: 0.75, bounceDelta: 0.02, newRate: 0.98, newDelta: -0.02,
    },
    trend: {
      days: trendDays, peak, avgPerDay,
      shares: baseSites.map((s) => ({ id: s.id, name: s.name, visitors: s.visitors, pct: s.visitors / totalV })),
    },
    insights: {
      topSite: baseSites[0] ? { id: baseSites[0].id, name: baseSites[0].name } : null,
      growingSite: baseSites[2] ? { id: baseSites[2].id, name: baseSites[2].name, delta: 9.53 } : baseSites[1] ? { id: baseSites[1].id, name: baseSites[1].name, delta: 0.2 } : null,
      needsCheck: baseSites[3] ? { id: baseSites[3].id, name: baseSites[3].name } : null,
      peakHour: '17:00–18:00',
      topSource: 'Google',
      topPage: baseSites[0] ? { title: 'OSPA • ספא ראש יפני - תאמו טיפול היכרות מפנק', path: '/try/', siteId: baseSites[0].id } : null,
      mobilePct: 0.85,
    },
    sites: baseSites,
    liveFeed: baseSites[0] ? [
      { id: '1', siteId: baseSites[0].id, siteName: baseSites[0].name, title: 'OSPA • ספא ראש יפני - תאמו טיפול היכרות מפנק', path: '/try/', source: 'ישיר', device: 'mobile', agoMin: 3, at: new Date().toISOString() },
      { id: '2', siteId: baseSites[0].id, siteName: baseSites[0].name, title: 'OSPA ראשון לציון • ספא ראש יפני בקו ראשון לים', path: '/try-rishon/', source: 'Google', device: 'mobile', agoMin: 5, at: new Date().toISOString() },
      { id: '3', siteId: baseSites[0].id, siteName: baseSites[0].name, title: 'ספא ראש יפני ועיסוי ראש עם מים', path: '/', source: 'ig', device: 'mobile', agoMin: 9, at: new Date().toISOString() },
      { id: '4', siteId: baseSites[0].id, siteName: baseSites[0].name, title: 'שובר מתנה לספא ולעיסוי ראש יפני', path: '/gift-card/', source: 'Bing', device: 'desktop', agoMin: 31, at: new Date().toISOString() },
    ] : [],
    sources: [
      { name: 'Google', count: 2158, pct: 0.42 },
      { name: 'ישיר', count: 1559, pct: 0.30 },
      { name: 'ig', count: 838, pct: 0.16 },
      { name: 'fb', count: 214, pct: 0.04 },
      { name: 'Facebook', count: 132, pct: 0.03 },
      { name: 'Instagram', count: 131, pct: 0.03 },
      { name: 'YouTube', count: 84, pct: 0.02 },
    ],
    devices: [
      { kind: 'mobile', count: 4473, pct: 0.85 },
      { kind: 'desktop', count: 601, pct: 0.11 },
      { kind: 'tablet', count: 158, pct: 0.03 },
    ],
    browsers: [
      { name: 'Chrome', count: 2345 }, { name: 'Safari', count: 1332 }, { name: 'Instagram', count: 953 },
      { name: 'Facebook', count: 302 }, { name: 'Samsung', count: 231 }, { name: 'Edge', count: 29 },
    ],
    heatmap,
    topPages: baseSites[0] ? [
      { title: 'OSPA • ספא ראש יפני - תאמו טיפול היכרות מפנק', path: '/try/', siteId: baseSites[0].id, siteName: baseSites[0].name, views: 3864, avgSec: 85 },
      { title: 'ספא ראש יפני ועיסוי ראש עם מים', path: '/', siteId: baseSites[0].id, siteName: baseSites[0].name, views: 1078, avgSec: 106 },
      { title: 'מסאז׳ ועיסויים במודיעין', path: '/massage/', siteId: baseSites[0].id, siteName: baseSites[0].name, views: 360, avgSec: 56 },
    ] : [],
  };
}

function demoSiteDetail(siteRec: any, days: number): SiteDetailReport {
  const defaultConvs: SiteConversion[] = Array.isArray(siteRec.conversions) && siteRec.conversions.length
    ? siteRec.conversions
    : [
        { id: 'c1', name: 'טופס לידים', type: 'form', selector: 'tryLeadForm', primary: true, value: 25, google_ads: true, total30d: 445, fromAds30d: 224, sentToGoogle30d: 224, last_tested_at: new Date().toISOString() },
        { id: 'c2', name: 'לידים עיסוי קלאסי', type: 'form', selector: '#msLeadForm', primary: true, google_ads: true, total30d: 18, fromAds30d: 10, sentToGoogle30d: 10 },
        { id: 'c3', name: 'שריון לאקדמיה', type: 'form', selector: 'שריון מקום', primary: true, google_ads: true, total30d: 8, fromAds30d: 6, sentToGoogle30d: 6 },
      ];
  return {
    hasData: true,
    site: { id: siteRec.id, name: siteRec.name, domain: cleanDomain(siteRec.domain || siteRec.url), url: siteRec.url || '', site_key: siteRec.site_key, shared: siteRec.shared, conversions: defaultConvs },
    online: 6,
    onlinePages: [
      { title: 'ספא ראש יפני - תאמו טיפול היכרות מפנק', path: '/try/', count: 3 },
      { title: 'שובר מתנה לספא ולעיסוי ראש יפני', path: '/gift-card/', count: 1 },
      { title: 'ספא ראש בראשון לציון', path: '/rishon-lezion/', count: 2 },
    ],
    kpis: { visitors: 4258, visitorsDelta: 0.27, views: 7121, viewsDelta: 0.32, visits: 4802, visitsDelta: 0.3, avgSec: 114, pagesPerVisit: 1.5, bounceRate: 0.76, newRate: 0.98 },
    daily: Array.from({ length: days }, (_, i) => ({ day: dayIso(days - 1 - i), visitors: Math.round(130 + 60 * Math.sin(i * 0.5)), views: Math.round(220 + 90 * Math.sin(i * 0.5)) })),
    hourlyToday: Array.from({ length: 24 }, (_, hour) => ({ hour, visitors: hour >= 8 && hour <= 22 ? Math.round(12 + 10 * Math.sin((hour - 10) * 0.4)) : 1, views: hour >= 8 ? 20 : 2 })),
    topPages: [
      { title: 'ספא ראש יפני - תאמו טיפול היכרות מפנק', path: '/try/', views: 3864, visitors: 2693, avgSec: 85 },
      { title: 'עמוד הבית', path: '/', views: 1078, visitors: 781, avgSec: 106 },
      { title: 'מסאז׳ ועיסויים במודיעין', path: '/massage/', views: 360, visitors: 279, avgSec: 56 },
      { title: 'שובר מתנה לספא', path: '/gift-card/', views: 185, visitors: 145, avgSec: 79 },
      { title: 'ספא ראש ברמת גן', path: '/spa-ramat-gan/', views: 182, visitors: 144, avgSec: 97 },
      { title: 'תודה!', path: '/thank-you/', views: 149, visitors: 125, avgSec: 15 },
    ],
    landingPages: [
      { path: '/try/', count: 2957 }, { path: '/', count: 727 }, { path: '/massage/', count: 241 },
      { path: '/spa-ramat-gan/', count: 141 }, { path: '/rishon-lezion/', count: 88 },
    ],
    sources: [
      { name: 'Google', count: 1723 }, { name: 'ישיר', count: 1365 }, { name: 'ig', count: 653 },
      { name: 'fb', count: 205 }, { name: 'Facebook', count: 96 }, { name: 'YouTube', count: 84 },
      { name: 'Instagram', count: 51 }, { name: 'chatgpt.com', count: 49 },
    ],
    devices: [
      { kind: 'mobile', count: 3704, pct: 0.87 },
      { kind: 'desktop', count: 426, pct: 0.1 },
      { kind: 'tablet', count: 128, pct: 0.03 },
    ],
    browsers: [
      { name: 'Chrome', count: 1950 }, { name: 'Safari', count: 1057 }, { name: 'Instagram', count: 703 },
      { name: 'Facebook', count: 292 }, { name: 'Samsung', count: 212 }, { name: 'Edge', count: 20 },
    ],
    countries: [{ name: 'ישראל', count: 4120 }, { name: 'לא ידוע', count: 138 }],
    conversions: defaultConvs,
    googleLog: [
      { id: 'g1', at: new Date().toISOString(), name: 'טופס לידים', path: '/try/', gclid: 'CjwKCAiA...', value: 25, sent: true },
      { id: 'g2', at: new Date(Date.now() - 3600e3).toISOString(), name: 'לידים עיסוי קלאסי', path: '/massage/', gclid: 'EAIaIQob...', value: null, sent: true },
    ],
  };
}
