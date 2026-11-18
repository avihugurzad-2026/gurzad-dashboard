import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { AlertTriangle, BarChart3, Clock, ExternalLink, Eye, Globe, Heart, Instagram, Megaphone, MousePointerClick, RefreshCw, Search, Settings2, Users, Wallet, Facebook } from 'lucide-react';
import { api } from '../../lib/api';
import { DEMO } from '../../lib/config';
import { useCollection } from '../../data/store';
import { usePrefs } from '../../lib/prefs';
import { shortDate } from '../../lib/format';
import { useCrud } from '../../ui/crud';
import { Badge, Card, CardHead, DotNum, Empty, Kpi, PageHead, PillTabs, Stagger, TabBody, easeOut } from '../../ui/kit';

const TONE = '#D64C86';
const TABS = [
  { value: 'meta', label: 'חשיפה במטא', icon: Megaphone },
  { value: 'sites', label: 'אתרים', icon: Globe },
] as const;
type Tab = (typeof TABS)[number]['value'];
const RANGES = [{ value: '7', label: '7 ימים' }, { value: '28', label: '28 ימים' }, { value: '90', label: '90 ימים' }];

const nf = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('he-IL', { notation: 'compact', maximumFractionDigits: 1 });
const cnt = (v: number | null | undefined) => (v == null ? '—' : nf.format(v));
const big = (v: number | null | undefined) => (v == null ? '—' : v >= 100000 ? compact.format(v) : nf.format(v));
const cur = (v: number, c = 'ILS', hide = false) => (hide ? '•••' : new Intl.NumberFormat('he-IL', { style: 'currency', currency: c, maximumFractionDigits: v < 100 ? 2 : 0 }).format(v));
const pctf = (v: number) => `${v.toFixed(v < 10 ? 2 : 1)}%`;

export function MarketingArea() {
  const { tab = 'meta' } = useParams();
  const nav = useNavigate();
  const [days, setDays] = useState('28');
  const View = tab === 'sites' ? Sites : MetaReach;
  return (
    <>
      <PageHead tag="שיווק ונוכחות" tone={TONE} title="שיווק" sub="חשיפה ברשתות ונתוני האתרים">
        <PillTabs id="mk-range" items={RANGES} value={days} onChange={setDays} />
      </PageHead>
      <div className="subnav"><PillTabs id="mk" items={[...TABS]} value={tab as Tab} onChange={(v) => nav(v === 'meta' ? '/marketing' : `/marketing/${v}`)} /></div>
      <TabBody id={tab}><View days={Number(days)} /></TabBody>
    </>
  );
}

/* ---------------- data hook ---------------- */
function useApi<T>(path: string | null, demo: () => T) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) { setState({ loading: false }); return; }
    if (DEMO) { setState({ data: demo(), loading: false }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    api<T>(path).then((data) => live && setState({ data, loading: false })).catch((e) => live && setState({ error: e.message, loading: false }));
    return () => { live = false; };
  }, [path, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/* ================= Meta ================= */
type Day = { day: string; paid?: number; fb?: number; ig?: number };
type MetaReport = {
  configured: boolean; missing?: string[];
  range: { since: string; until: string; days: number };
  paid: null | { reach: number; impressions: number; spend: number; clicks: number; ctr: number; cpm: number; frequency: number; results: number; currency: string; campaigns: { id: string; name: string; reach: number; impressions: number; spend: number; clicks: number }[] };
  facebook: null | { name: string; reach: number | null; views: number | null; engagements: number | null; followers: number | null };
  instagram: null | { username: string; reach: number | null; views: number | null; interactions: number | null; profileViews: number | null; followers: number | null };
  daily: Day[]; warnings: string[];
};

function MetaReach({ days }: { days: number }) {
  const prefs = usePrefs();
  const r = useApi<MetaReport>(`/api/marketing?source=meta&days=${days}`, () => demoMeta(days));
  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <ErrorCard text={r.error} onRetry={r.reload} />;
  const d = r.data!;
  if (!d.configured) return <MetaSetup missing={d.missing ?? []} />;

  const p = d.paid, fb = d.facebook, ig = d.instagram;
  const organic = (fb?.reach ?? 0) + (ig?.reach ?? 0);
  const total = (p?.reach ?? 0) + organic;
  const paidShare = total ? (p?.reach ?? 0) / total : 0;
  const series = d.daily.map((x) => (x.paid ?? 0) + (x.fb ?? 0) + (x.ig ?? 0));
  const smax = Math.max(1, ...series);

  return (
    <Stagger>
      {DEMO && <div className="lg-12"><Badge kind="info">נתוני הדגמה · בחשבון האמיתי יופיעו הנתונים מהחשבון של עדן</Badge></div>}
      {d.warnings.length > 0 && (
        <Card className="lg-12" style={{ background: 'var(--warn-bg, var(--surface-3))', borderColor: 'transparent' }}>
          <div className="row" style={{ alignItems: 'flex-start' }}><AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} /><div><b style={{ fontWeight: 500 }}>חלק מהנתונים לא נטענו</b><ul className="meta" style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>{d.warnings.map((w) => <li key={w} dir="auto">{w}</li>)}</ul></div></div>
        </Card>
      )}

      <Card className="hero hero-pink lg-5 md-12">
        <div className="spread"><span className="hero-label"><Eye size={16} />חשיפה כוללת</span><span className="hero-chip">{Math.round(paidShare * 100)}% ממומן</span></div>
        <div className="hero-num"><DotNum value={big(total)} label={`${cnt(total)} אנשים`} /></div>
        <div className="hero-sub">ממומן {big(p?.reach ?? 0)} · אורגני {big(organic)}<br />{shortDate(d.range.since)} עד {shortDate(d.range.until)}</div>
        <div className="hero-ticks" role="img" aria-label="חשיפה לפי יום">
          {series.slice(-30).map((v, i) => <i key={i} className="on" style={{ height: `${12 + (v / smax) * 88}%` }} />)}
        </div>
      </Card>

      <Card className="lg-7 md-12">
        <CardHead title="חשיפה לפי יום" sub="אנשים ייחודיים בכל יום · ממומן מול אורגני" />
        {d.daily.length ? <DayChart days={d.daily} /> : <Empty icon={BarChart3} title="אין נתונים עדיין" text="לא נמצאה פעילות בטווח הזה." />}
      </Card>

      {/* paid */}
      <Card className="lg-3 md-6 sm-6"><Kpi label="חשיפה ממומנת" icon={Megaphone} tone={TONE} value={p ? big(p.reach) : 'אין נתונים'} foot={p ? `${big(p.impressions)} הופעות · תדירות ${p.frequency.toFixed(1)}` : 'חשבון המודעות לא מחובר'} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="הוצאה על פרסום" icon={Wallet} tone={TONE} value={p ? cur(p.spend, p.currency, prefs.hide) : '—'} foot={p ? `CPM ${cur(p.cpm, p.currency, prefs.hide)}` : undefined} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="קליקים" icon={MousePointerClick} tone={TONE} value={p ? cnt(p.clicks) : '—'} foot={p ? `CTR ${pctf(p.ctr)}` : undefined} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="תוצאות (לידים, הודעות)" icon={Users} tone={TONE} value={p ? cnt(p.results) : '—'} foot={p && p.results ? `${cur(p.spend / p.results, p.currency, prefs.hide)} לתוצאה` : 'לפי יעד הקמפיין'} /></Card>

      {/* organic */}
      <Card className="lg-6 md-12">
        <CardHead title={<span className="row" style={{ gap: 8 }}><Facebook size={18} />פייסבוק אורגני</span>} sub={fb?.name || 'העמוד לא מחובר'} />
        {fb ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <Kpi label="חשיפה (סכום יומי)" value={big(fb.reach)} />
            <Kpi label="צפיות בתוכן" value={big(fb.views)} />
            <Kpi label="מעורבות בפוסטים" value={big(fb.engagements)} />
            <Kpi label="עוקבים" value={big(fb.followers)} />
          </div>
        ) : <Empty icon={Facebook} title="אין נתונים עדיין" text="צריך להגדיר את מזהה העמוד (META_PAGE_ID)." />}
      </Card>
      <Card className="lg-6 md-12">
        <CardHead title={<span className="row" style={{ gap: 8 }}><Instagram size={18} />אינסטגרם אורגני</span>} sub={ig?.username ? <bdi>@{ig.username}</bdi> : 'החשבון לא מקושר לעמוד'} />
        {ig ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <Kpi label="חשיפה (אנשים)" value={big(ig.reach)} />
            <Kpi label="צפיות" value={big(ig.views)} />
            <Kpi label="אינטראקציות" icon={Heart} value={big(ig.interactions)} />
            <Kpi label="עוקבים" value={big(ig.followers)} foot={ig.profileViews != null ? `${big(ig.profileViews)} כניסות לפרופיל` : undefined} />
          </div>
        ) : <Empty icon={Instagram} title="אין נתונים עדיין" text="קשר את חשבון האינסטגרם העסקי לעמוד הפייסבוק." />}
      </Card>

      <Card className="flush lg-12">
        <div className="card-head" style={{ padding: '20px 20px 0', marginBottom: 6 }}><div><h2>קמפיינים מובילים</h2><div className="sub">לפי חשיפה בטווח שנבחר</div></div></div>
        {p?.campaigns.length ? (
          <div className="list">
            {p.campaigns.map((c) => {
              const max = p.campaigns[0].reach || 1;
              return (
                <div key={c.id} className="li">
                  <span className="li-main">
                    <span className="li-title" style={{ display: 'block' }} dir="auto">{c.name}</span>
                    <span className="li-meta">{big(c.impressions)} הופעות · {cnt(c.clicks)} קליקים · {cur(c.spend, p.currency, prefs.hide)}</span>
                    <span style={{ display: 'block', height: 4, borderRadius: 4, background: 'var(--surface-3)', marginTop: 6, overflow: 'hidden' }}>
                      <motion.i style={{ display: 'block', height: '100%', background: TONE, transformOrigin: 'right' }} initial={{ scaleX: 0 }} animate={{ scaleX: c.reach / max }} transition={{ duration: 0.5, ease: easeOut }} />
                    </span>
                  </span>
                  <span className="li-end num"><b style={{ fontWeight: 500 }}>{big(c.reach)}</b></span>
                </div>
              );
            })}
          </div>
        ) : <Empty icon={Megaphone} title="אין קמפיינים פעילים בטווח" />}
      </Card>
      <p className="meta lg-12" style={{ margin: 0 }}>חשיפה = מספר האנשים שראו. בפייסבוק אורגני מטא נותנת רק נתון יומי, לכן הסכום סופר אדם שראה בכמה ימים יותר מפעם אחת. הנתונים עד אתמול ומתעדכנים כל 10 דקות.</p>
    </Stagger>
  );
}

/** Stacked daily bars: paid / Facebook / Instagram. RTL: oldest day on the right. */
function DayChart({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 200, padB = 22, padT = 8;
  const tot = days.map((d) => (d.paid ?? 0) + (d.fb ?? 0) + (d.ig ?? 0));
  const max = Math.max(1, ...tot);
  const slot = W / days.length;
  const bw = Math.max(2, Math.min(18, slot * 0.66));
  const h = (v: number) => ((H - padB - padT) * v) / max;
  const i = hover ?? days.length - 1;
  const cd = days[i];
  const labelEvery = Math.ceil(days.length / 7);
  return (
    <div>
      <div className="spread" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div className="legend">
          <span><i style={{ background: TONE }} />ממומן</span>
          <span><i style={{ background: 'var(--cobalt, #3340D6)' }} />פייסבוק</span>
          <span><i style={{ background: 'var(--lime, #DDF247)' }} />אינסטגרם</span>
        </div>
        {cd && <div className="meta num" aria-live="polite">{shortDate(cd.day)} · {cnt(cd.paid ?? 0)} / {cnt(cd.fb ?? 0)} / {cnt(cd.ig ?? 0)}</div>}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="חשיפה יומית" style={{ direction: 'ltr' }}>
        {[0.5, 1].map((t) => <line key={t} x1="0" x2={W} y1={H - padB - h(max * t)} y2={H - padB - h(max * t)} stroke="var(--line)" strokeDasharray="2 5" />)}
        {days.map((d, k) => {
          const cx = W - (slot * k + slot / 2);
          const a = h(d.paid ?? 0), b = h(d.fb ?? 0), c = h(d.ig ?? 0);
          const base = H - padB;
          return (
            <g key={d.day} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} onTouchStart={() => setHover(k)} opacity={hover == null || hover === k ? 1 : 0.5}>
              <rect x={cx - slot / 2} y="0" width={slot} height={H} fill="transparent" />
              <motion.g style={{ transformBox: 'fill-box', transformOrigin: 'bottom' }} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.45, ease: easeOut, delay: Math.min(0.3, k * 0.006) }}>
                <rect x={cx - bw / 2} y={base - a} width={bw} height={a} rx={Math.min(3, bw / 3)} fill={TONE} />
                <rect x={cx - bw / 2} y={base - a - b} width={bw} height={b} rx={Math.min(3, bw / 3)} fill="var(--cobalt, #3340D6)" />
                <rect x={cx - bw / 2} y={base - a - b - c} width={bw} height={c} rx={Math.min(3, bw / 3)} fill="var(--lime, #DDF247)" />
              </motion.g>
              {(days.length - 1 - k) % labelEvery === 0 && <text x={cx} y={H - 5} textAnchor="middle">{d.day.slice(8, 10)}/{d.day.slice(5, 7)}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MetaSetup({ missing }: { missing: string[] }) {
  return (
    <Stagger>
      <Card className="lg-12">
        <CardHead title="חיבור החשבון של עדן במטא" sub="פעם אחת, כ־10 דקות" />
        <ol className="stack" style={{ gap: 10, paddingInlineStart: 20, margin: 0, fontSize: 14 }}>
          <li>ב־<a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noreferrer">הגדרות העסק של Eden rusak Social Media › משתמשי מערכת</a> צור משתמש מערכת (Admin) ושייך לו את חשבון המודעות, את עמוד הפייסבוק ואת האינסטגרם.</li>
          <li>לחץ "צור טוקן", בחר את אפליקציית המטא של המשרד, תוקף "לעולם לא" והרשאות: <bdi className="ltr">ads_read, read_insights, pages_read_engagement, pages_show_list, instagram_basic, instagram_manage_insights</bdi>.</li>
          <li>ב־Vercel הוסף משתנים: <bdi className="ltr">META_ACCESS_TOKEN</bdi> (הטוקן), <bdi className="ltr">META_AD_ACCOUNT_ID</bdi> (מזהה חשבון המודעות), <bdi className="ltr">META_PAGE_ID</bdi> (מזהה העמוד). האינסטגרם מזוהה לבד דרך העמוד.</li>
        </ol>
        {missing.length > 0 && <p className="meta" style={{ marginTop: 12 }}>חסר כרגע: <bdi className="ltr">{missing.join(', ')}</bdi></p>}
      </Card>
    </Stagger>
  );
}

/* ================= Sites ================= */
type SiteReport = {
  configured: boolean;
  ga: null | { users: number; sessions: number; views: number; avgSec: number; keyEvents: number; daily: { day: string; users: number }[]; pages: { path: string; views: number }[]; channels: { name: string; sessions: number }[] };
  search: null | { site: string; clicks: number; impressions: number; ctr: number; position: number; queries: { q: string; clicks: number; impressions: number }[] };
  warnings: string[];
};

function Sites({ days }: { days: number }) {
  const monitors = useCollection('monitors');
  const sites = monitors.filter((m) => m.kind === 'אתר' && !/vercel\.app|localhost|127\.0\.0\.1/.test(m.url || ''));
  const [sel, setSel] = useState<string | undefined>();
  const site = sites.find((s) => s.id === sel) ?? sites[0];
  const crud = useCrud('monitors');
  const r = useApi<SiteReport>(site && (site.url || site.ga_property || DEMO) ? `/api/marketing?source=site&id=${site.id}&days=${days}` : null, () => demoSite(days));

  if (!sites.length) return (
    <Stagger>
      <Card className="lg-12"><Empty icon={Globe} title="אין עדיין אתרים" text="הוסף את האתר בעמוד סטטוס מערכות (סוג: אתר, עם כתובת), והוא יופיע כאן." action={<button className="btn btn-primary" onClick={() => crud.openNew({ kind: 'אתר' })}>הוספת אתר</button>} /></Card>
      {crud.sheet}
    </Stagger>
  );

  return (
    <>
      <div className="chips" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {sites.map((s) => <button key={s.id} className="chip" aria-pressed={s.id === site?.id} onClick={() => setSel(s.id)}>{s.name}</button>)}
      </div>
      <TabBody id={site.id}>
        {!site.url && !site.ga_property && !DEMO ? <div className="grid"><Card className="lg-12"><Empty icon={Globe} title="חסרה כתובת לאתר" text="הוסף את כתובת האתר ואת מזהה Google Analytics שלו." action={<button className="btn btn-primary" onClick={() => crud.openEdit(site)}>עריכת האתר</button>} /></Card></div> : r.loading && !r.data ? <Loading /> : r.error ? <ErrorCard text={r.error} onRetry={r.reload} /> : !r.data?.configured ? <SitesSetup /> : <SiteView site={site} d={r.data} onEdit={() => crud.openEdit(site)} />}
      </TabBody>
      {crud.sheet}
    </>
  );
}

function SiteView({ site, d, onEdit }: { site: any; d: SiteReport; onEdit: () => void }) {
  const ga = d.ga, s = d.search;
  const umax = Math.max(1, ...(ga?.daily.map((x) => x.users) ?? [1]));
  const mins = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  return (
    <Stagger>
      {DEMO && <div className="lg-12"><Badge kind="info">נתוני הדגמה</Badge></div>}
      {d.warnings.length > 0 && (
        <Card className="lg-12" style={{ background: 'var(--surface-3)', borderColor: 'transparent' }}>
          <div className="row" style={{ alignItems: 'flex-start' }}><AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} /><div><b style={{ fontWeight: 500 }}>חלק מהנתונים לא נטענו</b><ul className="meta" style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>{d.warnings.map((w) => <li key={w} dir="auto">{w}</li>)}</ul><p className="meta" style={{ marginTop: 4 }}>בדרך כלל זה אומר שחשבון השירות עוד לא נוסף כצופה לנכס.</p></div></div>
        </Card>
      )}
      <Card className="hero hero-slate lg-5 md-12">
        <div className="spread"><span className="hero-label"><Users size={16} />מבקרים באתר</span>{site.url && <a className="hero-chip" href={site.url} target="_blank" rel="noreferrer"><bdi className="ltr">{hostOf(site.url)}</bdi><ExternalLink size={12} /></a>}</div>
        <div className="hero-num"><DotNum value={ga ? big(ga.users) : '—'} label={ga ? `${cnt(ga.users)} מבקרים` : 'אין נתונים'} /></div>
        <div className="hero-sub">{ga ? `${cnt(ga.sessions)} ביקורים · ${cnt(ga.views)} צפיות בעמודים` : 'Google Analytics לא מחובר לאתר הזה'}</div>
        {ga && <div className="hero-ticks" role="img" aria-label="מבקרים לפי יום">{ga.daily.slice(-30).map((x, i) => <i key={i} className="on" style={{ height: `${12 + (x.users / umax) * 88}%` }} />)}</div>}
      </Card>

      <Card className="lg-7 md-12">
        <CardHead title="מאיפה מגיעים" sub="ביקורים לפי ערוץ" >{!site.ga_property && <button className="btn btn-soft btn-sm" onClick={onEdit}><Settings2 size={14} />חיבור Analytics</button>}</CardHead>
        {ga?.channels.length ? (
          <div className="stack" style={{ gap: 12 }}>
            {ga.channels.map((c) => (
              <div key={c.name}>
                <div className="spread" style={{ fontSize: 14 }}><bdi>{channelHe(c.name)}</bdi><span className="num">{cnt(c.sessions)}</span></div>
                <div style={{ height: 6, borderRadius: 6, background: 'var(--surface-3)', marginTop: 6, overflow: 'hidden' }}><motion.i style={{ display: 'block', height: '100%', background: 'var(--ink)', transformOrigin: 'right' }} initial={{ scaleX: 0 }} animate={{ scaleX: c.sessions / (ga.channels[0].sessions || 1) }} transition={{ duration: 0.5, ease: easeOut }} /></div>
              </div>
            ))}
          </div>
        ) : <Empty icon={BarChart3} title="אין נתונים עדיין" text={site.ga_property ? 'אין ביקורים בטווח הזה.' : 'הוסף לאתר את מזהה נכס GA4 כדי לראות תנועה.'} />}
      </Card>

      <Card className="lg-3 md-6 sm-6"><Kpi label="זמן ממוצע בביקור" icon={Clock} value={ga ? mins(ga.avgSec) : '—'} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="פעולות חשובות" icon={MousePointerClick} value={ga ? cnt(ga.keyEvents) : '—'} foot="לידים, טפסים, וואטסאפ" /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="קליקים מגוגל" icon={Search} value={s ? cnt(s.clicks) : '—'} foot={s ? `${big(s.impressions)} הופעות בחיפוש` : 'Search Console לא מחובר'} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="מיקום ממוצע בגוגל" icon={Search} value={s ? s.position.toFixed(1) : '—'} foot={s ? `CTR ${pctf(s.ctr * 100)}` : undefined} /></Card>

      <Card className="flush lg-6 md-12">
        <div className="card-head" style={{ padding: '20px 20px 0', marginBottom: 6 }}><h2>עמודים מובילים</h2></div>
        {ga?.pages.length ? <div className="list">{ga.pages.map((pg) => <div key={pg.path} className="li"><span className="li-main li-title"><bdi className="ltr">{decodeSafe(pg.path)}</bdi></span><span className="li-end num">{cnt(pg.views)}</span></div>)}</div> : <Empty icon={Globe} title="אין נתונים עדיין" />}
      </Card>
      <Card className="flush lg-6 md-12">
        <div className="card-head" style={{ padding: '20px 20px 0', marginBottom: 6 }}><div><h2>מה מחפשים בגוגל</h2>{s && <div className="sub">עד לפני 3 ימים (העיכוב של גוגל)</div>}</div></div>
        {s?.queries.length ? <div className="list">{s.queries.map((q) => <div key={q.q} className="li"><span className="li-main"><span className="li-title" style={{ display: 'block' }} dir="auto">{q.q}</span><span className="li-meta">{big(q.impressions)} הופעות</span></span><span className="li-end num">{cnt(q.clicks)} קליקים</span></div>)}</div> : <Empty icon={Search} title="אין נתונים עדיין" text="צריך להוסיף את חשבון השירות כמשתמש ב־Search Console של האתר." />}
      </Card>
    </Stagger>
  );
}

function SitesSetup() {
  return (
    <Stagger>
      <Card className="lg-12">
        <CardHead title="חיבור נתוני אתרים" sub="Google Analytics 4 ו־Search Console, פעם אחת לכל האתרים" />
        <ol className="stack" style={{ gap: 10, paddingInlineStart: 20, margin: 0, fontSize: 14 }}>
          <li>ב־Google Cloud (באותו פרויקט של היומן) הפעל את Google Analytics Data API ואת Search Console API.</li>
          <li>צור Service Account, הורד מפתח JSON והדבק את כל התוכן במשתנה <bdi className="ltr">GOOGLE_SERVICE_ACCOUNT_JSON</bdi> ב־Vercel.</li>
          <li>בכל אתר: ב־Analytics › ניהול › גישה לנכס, הוסף את כתובת המייל של חשבון השירות כ"צופה". ב־Search Console › הגדרות › משתמשים, הוסף אותה כמשתמש.</li>
          <li>בעמוד סטטוס מערכות, פתח את האתר והדבק את מזהה נכס GA4 (מספר בן 9 ספרות).</li>
        </ol>
      </Card>
    </Stagger>
  );
}

/* ---------------- bits ---------------- */
function Loading() {
  return <div className="grid">{[5, 7, 3, 3, 3, 3].map((w, i) => <div key={i} className={`card lg-${w} md-12 skeleton`} style={{ minHeight: i < 2 ? 220 : 110, opacity: 0.55 }} aria-busy="true" />)}</div>;
}
function ErrorCard({ text, onRetry }: { text: string; onRetry: () => void }) {
  return <div className="grid"><Card className="lg-12"><Empty icon={AlertTriangle} title="לא הצלחנו לטעון" text={text} action={<button className="btn btn-soft" onClick={onRetry}><RefreshCw size={14} />נסה שוב</button>} /></Card></div>;
}
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const decodeSafe = (s: string) => { try { return decodeURI(s); } catch { return s; } };
const CH: Record<string, string> = { 'Organic Search': 'חיפוש אורגני', Direct: 'ישיר', 'Organic Social': 'רשתות חברתיות', 'Paid Social': 'רשתות ממומן', Referral: 'הפניות מאתרים', 'Paid Search': 'חיפוש ממומן', Email: 'מייל', Unassigned: 'לא מסווג', 'Organic Video': 'וידאו', Display: 'באנרים', 'Cross-network': 'קמפיין משולב' };
const channelHe = (n: string) => CH[n] ?? n;

/* ---------------- demo data (demo mode only) ---------------- */
function seededDays(days: number, f: (i: number) => Day | { day: string; users: number }) { return Array.from({ length: days }, (_, i) => f(i)); }
const dayIso = (back: number) => new Date(Date.now() - (back + 1) * 864e5).toISOString().slice(0, 10);
function demoMeta(days: number): MetaReport {
  const w = (i: number, a: number) => Math.round(a * (0.75 + 0.35 * Math.sin(i * 0.7) + (i % 7 === 5 ? -0.3 : 0)));
  const daily = seededDays(days, (i) => ({ day: dayIso(days - 1 - i), paid: w(i, 2400), fb: w(i + 2, 380), ig: w(i + 4, 920) })) as Day[];
  const sum = (k: 'paid' | 'fb' | 'ig') => daily.reduce((a, d) => a + (d[k] ?? 0), 0);
  const reach = Math.round(sum('paid') * 0.42);
  return {
    configured: true, range: { since: daily[0].day, until: daily[daily.length - 1].day, days },
    paid: { reach, impressions: Math.round(reach * 2.6), spend: days * 61, clicks: Math.round(reach * 0.021), ctr: 0.81, cpm: 9.4, frequency: 2.6, results: Math.round(days * 1.7), currency: 'ILS', campaigns: [
      { id: '1', name: 'לידים · טיפולי פנים', reach: Math.round(reach * 0.48), impressions: Math.round(reach * 1.2), spend: days * 28, clicks: Math.round(reach * 0.01) },
      { id: '2', name: 'מודעות · סרטון הספא', reach: Math.round(reach * 0.34), impressions: Math.round(reach * 0.9), spend: days * 19, clicks: Math.round(reach * 0.006) },
      { id: '3', name: 'רימרקטינג · מבקרי אתר', reach: Math.round(reach * 0.18), impressions: Math.round(reach * 0.5), spend: days * 14, clicks: Math.round(reach * 0.005) },
    ] },
    facebook: { name: 'Eden Rusak', reach: sum('fb'), views: Math.round(sum('fb') * 1.9), engagements: Math.round(sum('fb') * 0.06), followers: 4820 },
    instagram: { username: 'edenrusak', reach: Math.round(sum('ig') * 0.55), views: Math.round(sum('ig') * 2.4), interactions: Math.round(sum('ig') * 0.08), profileViews: Math.round(sum('ig') * 0.05), followers: 12940 },
    daily, warnings: [],
  };
}
function demoSite(days: number): SiteReport {
  const daily = seededDays(days, (i) => ({ day: dayIso(days - 1 - i), users: Math.round(140 + 50 * Math.sin(i * 0.6)) })) as { day: string; users: number }[];
  const users = Math.round(daily.reduce((a, d) => a + d.users, 0) * 0.8);
  return {
    configured: true,
    ga: { users, sessions: Math.round(users * 1.3), views: Math.round(users * 2.7), avgSec: 94, keyEvents: Math.round(users * 0.03), daily, pages: [{ path: '/', views: Math.round(users * 1.1) }, { path: '/טיפולים', views: Math.round(users * 0.6) }, { path: '/צור-קשר', views: Math.round(users * 0.3) }], channels: [{ name: 'Paid Social', sessions: Math.round(users * 0.5) }, { name: 'Organic Search', sessions: Math.round(users * 0.35) }, { name: 'Direct', sessions: Math.round(users * 0.25) }, { name: 'Organic Social', sessions: Math.round(users * 0.15) }] },
    search: { site: 'sc-domain:example.co.il', clicks: Math.round(users * 0.3), impressions: Math.round(users * 6), ctr: 0.05, position: 8.4, queries: [{ q: 'ספא באזור', clicks: 41, impressions: 820 }, { q: 'טיפול פנים מחיר', clicks: 22, impressions: 610 }] },
    warnings: [],
  };
}

