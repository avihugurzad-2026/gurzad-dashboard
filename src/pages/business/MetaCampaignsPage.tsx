import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  Calendar,
  Check,
  ChevronLeft,
  Eye,
  Flame,
  MessageCircle,
  MousePointerClick,
  Pause,
  Play,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { api } from '../../lib/api';
import { DEMO } from '../../lib/config';
import { usePrefs } from '../../lib/prefs';
import { shortDate } from '../../lib/format';
import { useCollection } from '../../data/store';
import { Badge, Card, CardHead, Empty, Kpi, Meter, PageHead, PillTabs, Stagger, easeOut } from '../../ui/kit';
import { Sheet, useToast } from '../../ui/overlay';

const TONE = 'var(--tone-business)';

const RANGES = [
  { value: '1', label: 'אתמול' },
  { value: '3', label: '3 ימים' },
  { value: '7', label: '7 ימים' },
  { value: '14', label: '14 ימים' },
  { value: '30', label: '30 ימים' },
  { value: 'custom', label: 'טווח מותאם' },
] as const;
type RangeKey = (typeof RANGES)[number]['value'];

const CLIENT_RANGES = [
  { value: '7', label: '7 ימים' },
  { value: '14', label: '14 ימים' },
  { value: '30', label: '30 ימים' },
  { value: '90', label: '90 ימים' },
  { value: 'custom', label: 'תאריכים' },
] as const;

const DAILY_METRICS = [
  { value: 'leads', label: 'לידים', color: 'var(--g-green)' },
  { value: 'messages', label: 'התכתבויות', color: 'var(--cobalt)' },
  { value: 'impressions', label: 'הופעות / חשיפה', color: 'var(--g-pink)' },
  { value: 'profileVisits', label: 'ביקורי פרופיל', color: 'var(--g-orange)' },
  { value: 'spend', label: 'הוצאה (₪)', color: 'var(--ink)' },
] as const;
type DailyMetricKey = (typeof DAILY_METRICS)[number]['value'];

interface AdItem {
  id: string;
  name: string;
  campaignName?: string;
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

interface AccountItem {
  accountId: string;
  name: string;
  business: string;
  currency: string;
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
  winners: AdItem[];
  bleeding: AdItem[];
  error?: string;
}

interface AgentRec {
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

interface VerifiedActionLog {
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

interface OverviewPayload {
  configured: boolean;
  missing?: string[];
  range: { since: string; until: string; days: number };
  totals: {
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    leads: number;
    messages: number;
    profileVisits: number;
    purchases: number;
    activeCount: number;
    alertCount: number;
    winnerCount: number;
  };
  accounts: AccountItem[];
  skippedConditionalCount: number;
  recommendations: AgentRec[];
  agentSummary: string | null;
  agentLastRunAt: string | null;
  actionLogs?: VerifiedActionLog[];
}

interface DayRow {
  day: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  frequency: number;
  leads: number;
  messages: number;
  profileVisits: number;
  landingPageViews: number;
  primaryResults: number;
  resultType: string;
  costPerResult: number | null;
}

interface AccountDetailPayload {
  accountId: string;
  name: string;
  currency: string;
  range: { since: string; until: string; days: number };
  summary: Omit<DayRow, 'day'>;
  daily: DayRow[];
  campaigns: Array<{ id: string; name: string } & Omit<DayRow, 'day'>>;
  ads: AdItem[];
  winners: AdItem[];
  bleeding: AdItem[];
}

const nf = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('he-IL', { notation: 'compact', maximumFractionDigits: 1 });
const fmtNum = (v: number | null | undefined) => (v == null ? '—' : nf.format(Math.round(v)));
const fmtBig = (v: number | null | undefined) => (v == null ? '—' : v >= 100000 ? compact.format(v) : nf.format(Math.round(v)));
const fmtMoney = (v: number | null | undefined, c = 'ILS', hide = false) =>
  v == null ? '—' : hide ? '•••' : new Intl.NumberFormat('he-IL', { style: 'currency', currency: c, maximumFractionDigits: v < 100 && v > 0 ? 1 : 0 }).format(v);

const isoAgo = (back: number) => new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);

export function isAdigitalBusiness(b?: { id?: string; name?: string; kind?: string } | null) {
  if (!b) return false;
  if (b.id === 'biz-adigital') return true;
  const blob = `${b.name || ''} ${b.kind || ''}`.toLowerCase();
  return /אדיג|adigital|a-digital|gurzad|גורזאד|משרד פרסום/.test(blob);
}

export function MetaCampaignsPage() {
  const { bizId } = useParams();
  const prefs = usePrefs();
  const toast = useToast();
  const businesses = useCollection('businesses');
  const adigital = useMemo(
    () => businesses.find((b) => (bizId && b.id === bizId) || isAdigitalBusiness(b)) ?? businesses[0],
    [businesses, bizId],
  );

  const [rangeKey, setRangeKey] = useState<RangeKey>('7');
  const [customSince, setCustomSince] = useState(() => isoAgo(13));
  const [customUntil, setCustomUntil] = useState(() => isoAgo(0));

  const [filter, setFilter] = useState<'all' | 'alert' | 'winner' | 'idle'>('all');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<{ data?: OverviewPayload; loading: boolean; error?: string }>({ loading: true });
  const [tick, setTick] = useState(0);
  const [runningAgent, setRunningAgent] = useState(false);
  const [busyRecId, setBusyRecId] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<AccountItem | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const overviewUrl = useMemo(() => {
    if (rangeKey === 'custom') return `/api/marketing?source=campaigns_overview&since=${customSince}&until=${customUntil}`;
    return `/api/marketing?source=campaigns_overview&days=${rangeKey}`;
  }, [rangeKey, customSince, customUntil]);

  useEffect(() => {
    if (DEMO) {
      const days = rangeKey === 'custom' ? 14 : Number(rangeKey);
      setState({ data: buildDemoOverview(days), loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    api<OverviewPayload>(overviewUrl)
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e) => alive && setState({ error: e.message, loading: false }));
    return () => { alive = false; };
  }, [overviewUrl, tick]);

  const reload = () => setTick((t) => t + 1);

  const handleRunAgent = async () => {
    if (DEMO) {
      toast('במצב הדגמה מוצגות המלצות לדוגמה · בפרודקשן הסוכן מנתח נתונים חיים');
      return;
    }
    setRunningAgent(true);
    try {
      const days = rangeKey === 'custom' ? 7 : Number(rangeKey);
      await api('/api/marketing', { method: 'POST', body: { action: 'run_agent', days } });
      toast('סקירת הסוכן הושלמה ועודכנה');
      reload();
    } catch (e: any) {
      toast(e.message || 'הרצת הסוכן נכשלה');
    } finally {
      setRunningAgent(false);
    }
  };

  const handleRecAction = async (rec: AgentRec, nextState: 'approved' | 'skipped' | 'execute') => {
    if (DEMO) {
      const demoReceipt: VerifiedActionLog | null =
        nextState === 'execute'
          ? {
              id: 'demo-' + Date.now(),
              at: new Date().toISOString(),
              accountId: rec.accountId,
              accountName: rec.accountName,
              entityId: rec.targetEntityId || '1202500001',
              entityName: rec.targetEntityName || rec.title,
              actionType: rec.kind === 'scale_budget' ? 'budget_change' : 'status_change',
              beforeValue: rec.kind === 'scale_budget' ? '₪100/יום' : 'ACTIVE',
              afterValue: rec.kind === 'scale_budget' ? '₪120/יום' : 'PAUSED',
              verifiedOnMeta: true,
            }
          : null;
      setState((prev) =>
        prev.data
          ? {
              ...prev,
              data: {
                ...prev.data,
                recommendations: prev.data.recommendations.map((r) =>
                  r.id === rec.id ? { ...r, state: nextState === 'execute' ? 'executed' : nextState } : r,
                ),
                actionLogs: demoReceipt ? [demoReceipt, ...(prev.data.actionLogs ?? [])] : prev.data.actionLogs,
              },
            }
          : prev,
      );
      toast(nextState === 'skipped' ? 'ההמלצה נדחתה' : 'בוצע ואומת מול מטא (הדגמה)');
      return;
    }

    setBusyRecId(rec.id);
    try {
      if (nextState === 'execute' && (rec.kind === 'pause_ad' || rec.kind === 'scale_budget')) {
        const confirmMsg =
          rec.kind === 'pause_ad'
            ? `להשהות עכשיו במטא את "${rec.targetEntityName || rec.targetEntityId}" בחשבון ${rec.accountName}?`
            : `להעלות עכשיו ב-+20% את התקציב היומי הפעיל בחשבון ${rec.accountName} ולאמת מול מטא?`;
        if (!window.confirm(confirmMsg)) {
          setBusyRecId(null);
          return;
        }
        const res = await api<{ ok: boolean; receipt: VerifiedActionLog }>('/api/marketing', {
          method: 'POST',
          body: {
            action: 'execute_rec',
            recId: rec.id,
            kind: rec.kind,
            accountId: rec.accountId,
            accountName: rec.accountName,
            targetEntityId: rec.targetEntityId,
            targetEntityName: rec.targetEntityName,
            deltaPct: 20,
          },
        });
        const rc = res.receipt;
        toast(
          rc.verifiedOnMeta
            ? `אומת מול Meta API: ${rc.beforeValue} ← ${rc.afterValue}`
            : `נשלח למטא (${rc.afterValue}) — בדוק ביומן הביצועים`,
        );
      } else {
        await api('/api/marketing', {
          method: 'POST',
          body: { action: 'rec_state', recId: rec.id, state: nextState === 'execute' ? 'approved' : nextState },
        });
        toast(nextState === 'skipped' ? 'סומן כדילוג' : 'סומן כמאושר');
      }
      reload();
    } catch (e: any) {
      toast(e.message || 'הפעולה נכשלה');
    } finally {
      setBusyRecId(null);
    }
  };

  const handleLiveVerify = async (entityId: string) => {
    if (DEMO) {
      toast(`אימות חי (הדגמה) · מזהה ${entityId} מאומת מול שרתי Meta`);
      return;
    }
    setVerifyingId(entityId);
    try {
      const v = await api<{ id: string; name: string; status: string; effectiveStatus: string; dailyBudget: number | null }>(
        `/api/marketing?source=verify_entity&entityId=${entityId}`,
      );
      const budgetTxt = v.dailyBudget != null ? ` · תקציב ₪${v.dailyBudget.toFixed(0)}/יום` : '';
      toast(`בדיקה חיה במטא: "${v.name}" בסטטוס ${v.effectiveStatus || v.status}${budgetTxt}`);
    } catch (e: any) {
      toast(e.message || 'בדיקת הסטטוס נכשלה');
    } finally {
      setVerifyingId(null);
    }
  };

  const d = state.data;
  const pendingRecs = useMemo(
    () => (d?.recommendations ?? []).filter((r) => !r.state || r.state === 'pending'),
    [d],
  );

  const filteredAccounts = useMemo(() => {
    const list = d?.accounts ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((a) => {
      if (filter === 'alert' && a.health !== 'alert') return false;
      if (filter === 'winner' && a.health !== 'winner') return false;
      if (filter === 'idle' && a.spend > 0) return false;
      if (filter === 'all' && a.spend <= 0 && !q) return true;
      if (q && !`${a.name} ${a.business} ${a.accountId} ${a.statusLabel}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [d, filter, query]);

  const bleedingFeed = useMemo(() => {
    const out: Array<{ acc: AccountItem; ad: AdItem; ratio: number }> = [];
    for (const acc of d?.accounts ?? []) {
      const base = acc.costPerResult && acc.costPerResult > 0 ? acc.costPerResult : 25;
      for (const ad of acc.bleeding ?? []) {
        const ratio = ad.costPerResult ? Math.min(1, ad.costPerResult / (base * 3)) : Math.min(1, ad.spend / 180);
        out.push({ acc, ad, ratio: Math.max(0.35, ratio) });
      }
    }
    return out.sort((a, b) => b.ad.spend - a.ad.spend).slice(0, 5);
  }, [d]);

  const impactByAccount = useMemo(() => {
    const map = new Map<string, { name: string; amount: number }>();
    for (const r of d?.recommendations ?? []) {
      if (r.state === 'skipped') continue;
      const cur = map.get(r.accountId) ?? { name: r.accountName, amount: 0 };
      cur.amount += r.impactIls || 0;
      map.set(r.accountId, cur);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, 4);
  }, [d]);

  const totalImpact = impactByAccount.reduce((s, x) => s + x.amount, 0);

  return (
    <>
      <PageHead
        tag={`${adigital?.name || 'אדיג׳יטל'} · ניהול עסקים`}
        tone={TONE}
        title="ניהול קמפיינים במטא"
        sub={
          d?.range
            ? `${shortDate(d.range.since)} עד ${shortDate(d.range.until)} · לחץ על כל לקוח לפירוט יומי מלא של לידים, התכתבויות, חשיפות וביקורי פרופיל`
            : 'סקירת סוכן יומית, בקרת תקציבים ופירוט יומי לכל לקוח'
        }
      >
        {adigital && (
          <Link to={`/business/${adigital.id}`} className="btn btn-ghost btn-sm">
            <ArrowRight size={15} />חזרה ל{adigital.name}
          </Link>
        )}
        <button className="btn btn-soft btn-sm" onClick={() => setChatOpen(true)}>
          <Bot size={15} />צ׳אט חי עם הסוכן
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleRunAgent} disabled={runningAgent}>
          <Sparkles size={15} className={runningAgent ? 'spin' : undefined} />
          {runningAgent ? 'מנתח קמפיינים…' : 'הרץ סקירת סוכן'}
        </button>
      </PageHead>

      {/* Period selector bar */}
      <div className="subnav" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <PillTabs id="meta-camp-range" items={[...RANGES]} value={rangeKey} onChange={setRangeKey} />
        {rangeKey === 'custom' && (
          <div className="row wrap" style={{ gap: 8 }}>
            <input type="date" className="input" dir="ltr" style={{ height: 38, width: 150, fontSize: 14 }} value={customSince} onChange={(e) => setCustomSince(e.target.value)} aria-label="מתאריך" />
            <span className="meta">עד</span>
            <input type="date" className="input" dir="ltr" style={{ height: 38, width: 150, fontSize: 14 }} value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} aria-label="עד תאריך" />
          </div>
        )}
      </div>

      {state.loading && !d && (
        <div className="grid">
          {[3, 3, 3, 3, 8, 4, 4, 4, 4].map((w, i) => (
            <div key={i} className={`card lg-${w} md-12 skeleton`} style={{ minHeight: i < 4 ? 118 : 260, opacity: 0.55 }} aria-busy="true" />
          ))}
        </div>
      )}

      {state.error && !d && (
        <Card className="lg-12">
          <Empty
            icon={AlertTriangle}
            title="לא הצלחנו לטעון את נתוני הקמפיינים"
            text={state.error}
            action={<button className="btn btn-soft" onClick={reload}><RefreshCw size={15} />נסה שוב</button>}
          />
        </Card>
      )}

      {d && !d.configured && (
        <Stagger>
          <Card className="lg-12">
            <CardHead title="הגדרת חיבור Meta Ads לפורטל האונליין" sub="צעד חד־פעמי ב־Vercel כדי שהעמוד והסוכן יעבדו באונליין 24/7" />
            <ol className="steps">
              <li>הוסף במשתני הסביבה של הפרויקט ב־Vercel את המשתנה <bdi className="ltr">META_ADS_ACCESS_TOKEN</bdi> (טוקן המערכת או ה־60 יום שהפקנו תחת <bdi className="ltr">a-digital agent</bdi>).</li>
              <li>ודא שמוגדר גם <bdi className="ltr">GEMINI_API_KEY</bdi> ב־Vercel כדי שהסוכן היומי יפיק ניתוח והמלצות חכמות בכל בוקר דרך ה־Cron הקיים.</li>
              <li>בצע Deploy קצר (או רענון) — כל 23 חשבונות הלקוחות של אדיג׳יטל ייטענו אוטומטית עם פירוט יומי מלא.</li>
            </ol>
          </Card>
        </Stagger>
      )}

      {d && d.configured && (
        <Stagger>
          {d.accounts.some((a) => a.error) && (
            <Card className="lg-12" style={{ background: 'var(--warn-bg)', borderColor: 'transparent', padding: '12px 18px' }}>
              <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2, color: 'var(--warn)' }} />
                <div style={{ fontSize: 13 }}>
                  <b style={{ fontWeight: 500 }}>חלק מהחשבונות החזירו שגיאה מ־Meta</b>
                  <div className="meta" dir="auto" style={{ marginTop: 2 }}>
                    {d.accounts.find((a) => a.error)?.error}
                  </div>
                </div>
              </div>
            </Card>
          )}
          {/* Agent summary banner */}
          {d.agentSummary && (
            <Card className="soft lg-12" style={{ padding: '14px 20px' }}>
              <div className="spread wrap" style={{ gap: 12 }}>
                <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                  <span className="li-icon" style={{ background: 'var(--lime)', color: 'var(--on-lime)', width: 36, height: 36 }}>
                    <Bot size={18} />
                  </span>
                  <div>
                    <b style={{ fontWeight: 500, fontSize: 14 }}>תמונת מצב מהסוכן היומי</b>
                    <p style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 2 }}>{d.agentSummary}</p>
                  </div>
                </div>
                {d.agentLastRunAt && <span className="meta">עודכן {shortDate(d.agentLastRunAt.slice(0, 10))}</span>}
              </div>
            </Card>
          )}

          {/* Row 1: 4 Executive KPI Cards */}
          <Card className="lg-3 md-6 sm-6">
            <Kpi
              label="הוצאה כוללת"
              icon={Wallet}
              tone={TONE}
              value={fmtMoney(d.totals.spend, 'ILS', prefs.hide)}
              foot={`${d.totals.activeCount} חשבונות פעילים · ${fmtBig(d.totals.impressions)} הופעות`}
            />
          </Card>

          <Card className="lg-3 md-6 sm-6">
            <Kpi
              label="ממתין לאישור שלך"
              icon={Sparkles}
              tone="var(--g-orange)"
              value={fmtNum(pendingRecs.length)}
              foot={pendingRecs.length ? `${pendingRecs.filter((r) => r.priority === 'high').length} בעדיפות גבוהה` : 'כל ההמלצות טופלו'}
            />
          </Card>

          <Card className="lg-3 md-6 sm-6">
            <Kpi
              label="התראות ושחיקה"
              icon={Flame}
              tone="var(--neg)"
              value={fmtNum(d.totals.alertCount)}
              foot={d.totals.alertCount ? 'שחיקת קהל או מודעות יקרות' : 'כל החשבונות בטווח בריא'}
            />
          </Card>

          <Card className="lg-3 md-6 sm-6">
            <Kpi
              label="לידים והתכתבויות"
              icon={Users}
              tone="var(--g-green)"
              value={fmtNum(d.totals.leads + d.totals.messages)}
              foot={`${fmtNum(d.totals.leads)} לידים · ${fmtNum(d.totals.messages)} שיחות · ${fmtBig(d.totals.profileVisits)} ביקורי פרופיל`}
            />
          </Card>

          {/* Row 2: Main Accounts Board (8 cols) + Waiting For You Action Queue (4 cols) */}
          <Card className="flush lg-8 md-12">
            <div style={{ padding: '20px 20px 12px' }}>
              <div className="spread wrap" style={{ gap: 12, marginBottom: 14 }}>
                <div>
                  <h2 style={{ fontSize: 19 }}>לקוחות וחשבונות מודעות</h2>
                  <div className="meta" style={{ marginTop: 2 }}>לחץ על כל לקוח לגרף וטבלה יומית של לידים, התכתבויות, חשיפות וביקורים בפרופיל</div>
                </div>
                <div style={{ position: 'relative', flex: '1 1 210px', maxWidth: 280 }}>
                  <input
                    className="input"
                    style={{ height: 38, borderRadius: 999, paddingInlineStart: 36, fontSize: 16 }}
                    placeholder="חיפוש לקוח או מזהה…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <Search size={15} style={{ position: 'absolute', insetInlineStart: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', pointerEvents: 'none' }} />
                </div>
              </div>

              <div className="spread wrap" style={{ gap: 12 }}>
                <div className="chips">
                  {([
                    ['all', 'הכול', d.accounts.length],
                    ['alert', 'דורש טיפול', d.totals.alertCount],
                    ['winner', 'מנצחים', d.totals.winnerCount],
                    ['idle', 'ללא הוצאה', d.accounts.filter((a) => a.spend <= 0).length],
                  ] as const).map(([val, label, count]) => (
                    <button key={val} className="chip" aria-pressed={filter === val} onClick={() => setFilter(val)}>
                      {label}<span className="count num">{count}</span>
                    </button>
                  ))}
                </div>

                {/* Compact Morning Health Ring Summary */}
                <div className="row hide-sm" style={{ gap: 10, background: 'var(--surface-2)', padding: '6px 12px', borderRadius: 999 }}>
                  <MorningRing winners={d.totals.winnerCount} alerts={d.totals.alertCount} active={d.totals.activeCount} />
                  <span className="meta">
                    <b style={{ color: 'var(--pos)', fontWeight: 500 }}>{d.totals.winnerCount}</b> מנצחים ·{' '}
                    <b style={{ color: 'var(--neg)', fontWeight: 500 }}>{d.totals.alertCount}</b> התראות
                  </span>
                </div>
              </div>
            </div>

            {filteredAccounts.length === 0 ? (
              <Empty icon={BarChart3} title="לא נמצאו חשבונות בסינון הזה" />
            ) : (
              <div className="list" style={{ maxHeight: 540, overflowY: 'auto' }}>
                {filteredAccounts.map((acc) => {
                  const badgeKind = acc.health === 'alert' ? 'neg' : acc.health === 'winner' ? 'pos' : acc.health === 'ok' ? 'info' : 'none';
                  return (
                    <button
                      key={acc.accountId}
                      className="li clickable"
                      style={{ width: '100%', textAlign: 'start', alignItems: 'center' }}
                      onClick={() => setSelectedAccount(acc)}
                    >
                      <span
                        className="li-icon"
                        style={{
                          color: acc.health === 'alert' ? 'var(--neg)' : acc.health === 'winner' ? 'var(--pos)' : 'var(--tone-business)',
                          background: acc.health === 'alert' ? 'var(--neg-bg)' : acc.health === 'winner' ? 'var(--pos-bg)' : 'var(--surface)',
                        }}
                      >
                        {acc.health === 'alert' ? <Flame size={18} /> : acc.health === 'winner' ? <TrendingUp size={18} /> : <BarChart3 size={18} />}
                      </span>

                      <span className="li-main">
                        <span className="li-title" style={{ display: 'block' }}>{acc.name}</span>
                        <span className="li-meta">
                          {acc.leads > 0 && <span><b>{fmtNum(acc.leads)}</b> לידים</span>}
                          {acc.messages > 0 && <span>· <b>{fmtNum(acc.messages)}</b> התכתבויות</span>}
                          {acc.impressions > 0 && <span>· {fmtBig(acc.impressions)} הופעות</span>}
                          {acc.profileVisits > 0 && <span className="hide-sm">· {fmtBig(acc.profileVisits)} ביקורי פרופיל</span>}
                          {acc.frequency > 0 && <span className="hide-sm">· תדירות {acc.frequency.toFixed(2)}</span>}
                          {acc.spend <= 0 && <span>ללא הוצאה בטווח שנבחר</span>}
                        </span>
                      </span>

                      <span className="li-end" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <span className="li-amount">{fmtMoney(acc.spend, acc.currency, prefs.hide)}</span>
                        <span className="row" style={{ gap: 6 }}>
                          {acc.costPerResult != null && (
                            <span className="meta num hide-sm">{fmtMoney(acc.costPerResult, acc.currency, prefs.hide)} / תוצאה</span>
                          )}
                          <Badge kind={badgeKind} icon={false}>{acc.statusLabel}</Badge>
                        </span>
                      </span>
                      <ChevronLeft size={16} className="muted hide-sm" />
                    </button>
                  );
                })}
              </div>
            )}

            {d.skippedConditionalCount > 0 && (
              <div className="meta" style={{ padding: '10px 20px 14px', borderTop: '1px solid var(--line)' }}>
                {d.skippedConditionalCount} חשבונות מותנים ללא הוצאה הוסתרו אוטומטית מהלוח (יופיעו ברגע שיוציאו תקציב).
              </div>
            )}
          </Card>

          {/* Right/Side Card: Waiting For You (Agent Recommendations Queue) */}
          <Card className="flush lg-4 md-12" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="spread" style={{ padding: '20px 20px 8px' }}>
              <div>
                <h2 style={{ fontSize: 19 }}>ממתין לאישור שלך</h2>
                <div className="meta" style={{ marginTop: 2 }}>המלצות הסוכן היומי · שום שינוי לא מבוצע בלי אישור</div>
              </div>
              <Badge kind={pendingRecs.length ? 'warn' : 'pos'} icon={false}>{pendingRecs.length} פתוחות</Badge>
            </div>

            {d.recommendations.length === 0 ? (
              <Empty icon={Check} title="אין המלצות פתוחות" text="כל הקמפיינים הפעילים עובדים בטווח תקין." />
            ) : (
              <div className="list" style={{ maxHeight: 540, overflowY: 'auto' }}>
                {d.recommendations.map((rec, idx) => {
                  const done = rec.state === 'approved' || rec.state === 'executed';
                  const skipped = rec.state === 'skipped';
                  const busy = busyRecId === rec.id;
                  return (
                    <div
                      key={rec.id}
                      className="li"
                      style={{
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: 10,
                        opacity: skipped ? 0.5 : 1,
                        border: done ? '1px solid var(--pos)' : undefined,
                      }}
                    >
                      <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                        <span
                          className="li-icon num"
                          style={{
                            width: 30,
                            height: 30,
                            fontSize: 13,
                            fontWeight: 700,
                            background: rec.priority === 'high' ? 'var(--neg-bg)' : 'var(--lime)',
                            color: rec.priority === 'high' ? 'var(--neg)' : 'var(--on-lime)',
                          }}
                        >
                          {idx + 1}
                        </span>
                        <div className="li-main">
                          <div className="li-title" style={{ fontSize: 14 }}>{rec.title}</div>
                          <div className="meta" style={{ marginTop: 3, lineHeight: 1.45 }}>{rec.reason}</div>
                        </div>
                      </div>

                      <div className="spread wrap" style={{ gap: 8, paddingTop: 2 }}>
                        <span className="badge" style={{ fontSize: 11.5 }}>
                          {rec.kind === 'pause_ad' ? `חיסכון ~₪${fmtNum(rec.impactIls)}` : rec.kind === 'scale_budget' ? 'פוטנציאל צמיחה' : 'רענון קריאייטיב'}
                        </span>

                        {rec.state === 'executed' ? (
                          <Badge kind="pos">בוצע במטא</Badge>
                        ) : done ? (
                          <Badge kind="pos">אושר</Badge>
                        ) : (
                          <div className="row" style={{ gap: 6 }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ height: 32, paddingInline: 12, fontSize: 12 }}
                              disabled={busy}
                              onClick={() => handleRecAction(rec, 'skipped')}
                            >
                              דלג
                            </button>
                            {rec.kind === 'pause_ad' && rec.targetEntityId ? (
                              <button
                                className="btn btn-primary btn-sm"
                                style={{ height: 32, paddingInline: 12, fontSize: 12 }}
                                disabled={busy}
                                onClick={() => handleRecAction(rec, 'execute')}
                              >
                                <Pause size={13} />השהה במטא
                              </button>
                            ) : rec.kind === 'scale_budget' ? (
                              <button
                                className="btn btn-primary btn-sm"
                                style={{ height: 32, paddingInline: 12, fontSize: 12 }}
                                disabled={busy}
                                onClick={() => handleRecAction(rec, 'execute')}
                              >
                                <TrendingUp size={13} />העלה +20% במטא
                              </button>
                            ) : (
                              <button
                                className="btn btn-primary btn-sm"
                                style={{ height: 32, paddingInline: 12, fontSize: 12 }}
                                disabled={busy}
                                onClick={() => handleRecAction(rec, 'approved')}
                              >
                                <Check size={13} />אשר
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Row 3: 3 Bottom Executive Analytics Cards (matching Kestrel inspiration in Gurzad style) */}
          <Card className="lg-4 md-12">
            <CardHead title="שחיקת קהל מול היעד" sub="תדירות חשיפה · אזור בריא 1.0–3.0" />
            <div className="stack" style={{ gap: 12 }}>
              {d.accounts
                .filter((a) => a.spend > 0 && a.frequency > 0)
                .sort((a, b) => b.frequency - a.frequency)
                .slice(0, 6)
                .map((a) => {
                  const pct = Math.min(96, Math.max(4, (a.frequency / 7) * 100));
                  const dotColor = a.frequency >= 4.2 ? 'var(--neg)' : a.frequency >= 3.2 ? 'var(--g-orange)' : 'var(--g-green)';
                  return (
                    <button
                      key={a.accountId}
                      onClick={() => setSelectedAccount(a)}
                      style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                    >
                      <span style={{ width: 108, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                      <div style={{ flex: 1, height: 20, borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--line)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, bottom: 0, right: '14%', width: '29%', background: 'var(--pos-bg)', opacity: 0.85 }} />
                        <span style={{ position: 'absolute', top: '50%', right: `calc(${pct}% - 6px)`, transform: 'translateY(-50%)', width: 12, height: 12, borderRadius: '50%', background: dotColor, boxShadow: '0 0 0 2px var(--surface)' }} />
                      </div>
                      <b className="num" style={{ width: 36, textAlign: 'end', fontSize: 13, fontWeight: 500, color: dotColor }}>{a.frequency.toFixed(2)}</b>
                    </button>
                  );
                })}
            </div>
          </Card>

          <Card className="lg-4 md-12">
            <CardHead title="מודעות קרובות לעצירה" sub="חריגת עלות לתוצאה מול ממוצע החשבון" />
            {bleedingFeed.length === 0 ? (
              <p className="meta">לא זוהו מודעות פעילות ששורפות תקציב בטווח הזה.</p>
            ) : (
              <div className="stack" style={{ gap: 13 }}>
                {bleedingFeed.map(({ acc, ad, ratio }) => (
                  <div key={ad.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedAccount(acc)}>
                    <div className="spread" style={{ marginBottom: 5, gap: 8 }}>
                      <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <b style={{ fontWeight: 500 }}>{acc.name}</b> · {ad.name}
                      </span>
                      <span className="meta num" style={{ flexShrink: 0 }}>
                        {ad.costPerResult != null ? `${fmtMoney(ad.costPerResult, acc.currency, prefs.hide)} / תוצאה` : `${fmtMoney(ad.spend, acc.currency, prefs.hide)} ללא תוצאה`}
                      </span>
                    </div>
                    <Meter small value={ratio * 100} max={100} tone={ratio > 0.75 ? 'var(--neg)' : 'var(--g-orange)'} />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="lg-4 md-12">
            <CardHead title="השפעת אופטימיזציה צפויה" sub="תקציב שניתן לחסוך ולהסיט למנצחות" />
            <div style={{ marginBottom: 14 }}>
              <div className="kpi-value num" style={{ fontSize: 30, color: 'var(--pos)', fontWeight: 500 }}>
                +{fmtMoney(totalImpact, 'ILS', prefs.hide)}
              </div>
              <div className="meta">פוטנציאל התייעלות בטווח הנוכחי לפני העלאת תקציב</div>
            </div>
            {impactByAccount.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${impactByAccount.length}, minmax(0, 1fr))`, gap: 10, alignItems: 'end', height: 118 }}>
                {impactByAccount.map((item, idx) => {
                  const max = Math.max(1, impactByAccount[0].amount);
                  const barH = Math.max(20, Math.round((item.amount / max) * 82));
                  const colors = ['var(--g-green)', 'var(--cobalt)', 'var(--g-pink)', 'var(--g-orange)'];
                  return (
                    <div key={item.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, minWidth: 0 }}>
                      <span className="meta num" style={{ fontSize: 11 }}>{fmtMoney(item.amount, 'ILS', prefs.hide)}</span>
                      <motion.div
                        initial={{ scaleY: 0 }}
                        animate={{ scaleY: 1 }}
                        transition={{ duration: 0.4, ease: easeOut, delay: idx * 0.05 }}
                        style={{ width: '100%', height: barH, borderRadius: '12px 12px 6px 6px', background: colors[idx % colors.length], transformOrigin: 'bottom' }}
                      />
                      <span className="meta" style={{ fontSize: 11, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          {/* Row 4: Verified Execution Audit Log (Read-back verified from Meta API) */}
          <Card className="flush lg-12">
            <div className="spread wrap" style={{ padding: '20px 20px 10px', gap: 10 }}>
              <div>
                <h2 style={{ fontSize: 19 }}>יומן ביצועים מאומת מול שרתי מטא</h2>
                <div className="meta" style={{ marginTop: 2 }}>כל פעולה נבדקת בקריאה חוזרת (Read-back) מ־Meta Graph API מיד לאחר השליחה · ניתן לבדוק סטטוס חי בכל רגע</div>
              </div>
              <Badge kind="pos"><ShieldCheck size={13} />אימות דו־כיווני פעיל</Badge>
            </div>
            {!d.actionLogs?.length ? (
              <div className="meta" style={{ padding: '6px 20px 20px' }}>
                עדיין לא בוצעו שינויים במטא. ברגע שתלחץ על "השהה במטא", "העלה +20% במטא" או תבקש פעולה בצ׳אט החי — הקבלה המאומתת תופיע כאן.
              </div>
            ) : (
              <div className="list">
                {d.actionLogs.map((log, i) => (
                  <div key={log.id || log.at + i} className="li" style={{ flexWrap: 'wrap', gap: 10 }}>
                    <span className="li-icon" style={{ background: log.verifiedOnMeta ? 'var(--pos-bg)' : 'var(--warn-bg)', color: log.verifiedOnMeta ? 'var(--pos)' : 'var(--warn)' }}>
                      <ShieldCheck size={18} />
                    </span>
                    <div className="li-main">
                      <div className="li-title">{log.accountName} · {log.entityName}</div>
                      <div className="li-meta">
                        <span className="ltr">ID: {log.entityId}</span>
                        <span>· {shortDate(log.at.slice(0, 10))} {log.at.slice(11, 16)}</span>
                        <span>· <b dir="ltr">{log.beforeValue} → {log.afterValue}</b></span>
                      </div>
                    </div>
                    <div className="li-end" style={{ gap: 8 }}>
                      <Badge kind={log.verifiedOnMeta ? 'pos' : 'warn'}>
                        {log.verifiedOnMeta ? 'אומת מול Meta API' : 'ממתין לאימות'}
                      </Badge>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ height: 32, paddingInline: 12, fontSize: 12 }}
                        disabled={verifyingId === log.entityId}
                        onClick={() => handleLiveVerify(log.entityId)}
                      >
                        <RefreshCw size={12} className={verifyingId === log.entityId ? 'spin' : undefined} />בדוק חי במטא
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Stagger>
      )}

      {/* Live Agent Chat Drawer */}
      <AgentChatSheet open={chatOpen} onClose={() => setChatOpen(false)} onMutated={reload} />

      {/* Client Deep Drill-Down Sheet (Daily Leads, Messages, Reach/Impressions, Profile Visits + Ads) */}
      <ClientDetailSheet
        account={selectedAccount}
        initialDays={rangeKey === 'custom' ? '14' : rangeKey === '1' || rangeKey === '3' ? '7' : rangeKey}
        onClose={() => setSelectedAccount(null)}
        onMutated={reload}
      />
    </>
  );
}

/* ================= Client Deep Drill-Down Sheet ================= */
function ClientDetailSheet({
  account,
  initialDays,
  onClose,
  onMutated,
}: {
  account: AccountItem | null;
  initialDays: string;
  onClose: () => void;
  onMutated: () => void;
}) {
  const prefs = usePrefs();
  const toast = useToast();
  const [range, setRange] = useState<string>(initialDays);
  const [since, setSince] = useState(() => isoAgo(13));
  const [until, setUntil] = useState(() => isoAgo(0));
  const [tab, setTab] = useState<'daily' | 'ads' | 'campaigns'>('daily');
  const [metric, setMetric] = useState<DailyMetricKey>('leads');
  const [state, setState] = useState<{ data?: AccountDetailPayload; loading: boolean; error?: string }>({ loading: false });
  const [tick, setTick] = useState(0);
  const [busyAd, setBusyAd] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    setTab('daily');
    // Pick default chart metric based on what the client actually generates
    if (account.leads > 0) setMetric('leads');
    else if (account.messages > 0) setMetric('messages');
    else if (account.profileVisits > 0) setMetric('profileVisits');
    else setMetric('impressions');
  }, [account?.accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!account) return;
    if (DEMO) {
      const dCount = range === 'custom' ? 14 : Number(range);
      setState({ data: buildDemoAccountDetail(account, dCount), loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const q =
      range === 'custom'
        ? `/api/marketing?source=campaigns_account&accountId=${account.accountId}&since=${since}&until=${until}`
        : `/api/marketing?source=campaigns_account&accountId=${account.accountId}&days=${range}`;
    api<AccountDetailPayload>(q)
      .then((data) => alive && setState({ data, loading: false }))
      .catch((e) => alive && setState({ error: e.message, loading: false }));
    return () => { alive = false; };
  }, [account, range, since, until, tick]);

  const toggleAdStatus = async (ad: AdItem) => {
    if (!account) return;
    const nextStatus = ad.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    if (DEMO) {
      toast(`במצב הדגמה: המודעה סומנה כ-${nextStatus === 'PAUSED' ? 'מושהית' : 'פעילה'}`);
      return;
    }
    if (!window.confirm(`${nextStatus === 'PAUSED' ? 'להשהות' : 'להפעיל מחדש'} את המודעה "${ad.name}"?`)) return;
    setBusyAd(ad.id);
    try {
      await api('/api/marketing', {
        method: 'POST',
        body: {
          action: 'set_entity_status',
          entityId: ad.id,
          status: nextStatus,
          accountId: account.accountId,
          accountName: account.name,
          entityName: ad.name,
        },
      });
      toast(nextStatus === 'PAUSED' ? 'המודעה הושהתה' : 'המודעה הופעלה');
      setTick((t) => t + 1);
      onMutated();
    } catch (e: any) {
      toast(e.message || 'שינוי הסטטוס נכשל');
    } finally {
      setBusyAd(null);
    }
  };

  const d = state.data;
  const cur = d?.currency || account?.currency || 'ILS';

  return (
    <Sheet wide open={Boolean(account)} onClose={onClose} title={account?.name || 'פרטי לקוח'}>
      <div className="sheet-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Period Controls */}
        <div className="stack" style={{ gap: 10 }}>
          <div className="spread wrap" style={{ gap: 8 }}>
            <span className="meta ltr">ID: {account?.accountId}</span>
            <PillTabs id="client-detail-range" items={[...CLIENT_RANGES]} value={range as any} onChange={setRange} />
          </div>
          {range === 'custom' && (
            <div className="row wrap" style={{ gap: 8 }}>
              <Calendar size={15} className="muted" />
              <input type="date" className="input" dir="ltr" style={{ height: 38, flex: 1, minWidth: 130, fontSize: 14 }} value={since} onChange={(e) => setSince(e.target.value)} />
              <span className="meta">עד</span>
              <input type="date" className="input" dir="ltr" style={{ height: 38, flex: 1, minWidth: 130, fontSize: 14 }} value={until} onChange={(e) => setUntil(e.target.value)} />
            </div>
          )}
        </div>

        {state.loading && !d && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="skeleton" style={{ height: 110 }} />
            <div className="skeleton" style={{ height: 200 }} />
            <div className="skeleton" style={{ height: 220 }} />
          </div>
        )}

        {state.error && (
          <Empty icon={AlertTriangle} title="שגיאה בטעינת הלקוח" text={state.error} action={<button className="btn btn-soft btn-sm" onClick={() => setTick((t) => t + 1)}>נסה שוב</button>} />
        )}

        {d && (
          <>
            {/* 6 Granular Client KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 10 }}>
              <div className="card soft" style={{ padding: 12 }}>
                <div className="meta" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Wallet size={13} />הוצאה</div>
                <div className="num" style={{ fontSize: 20, fontWeight: 500, marginTop: 4 }}>{fmtMoney(d.summary.spend, cur, prefs.hide)}</div>
                <div className="meta">{d.summary.costPerResult != null ? `${fmtMoney(d.summary.costPerResult, cur, prefs.hide)} לתוצאה` : '—'}</div>
              </div>
              <div className="card soft" style={{ padding: 12 }}>
                <div className="meta" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><UserCheck size={13} />לידים</div>
                <div className="num" style={{ fontSize: 20, fontWeight: 500, marginTop: 4, color: 'var(--pos)' }}>{fmtNum(d.summary.leads)}</div>
                <div className="meta">{d.summary.leads > 0 ? `${fmtMoney(d.summary.spend / d.summary.leads, cur, prefs.hide)} לליד` : 'אין לידים'}</div>
              </div>
              <div className="card soft" style={{ padding: 12 }}>
                <div className="meta" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><MessageCircle size={13} />התכתבויות חדשות</div>
                <div className="num" style={{ fontSize: 20, fontWeight: 500, marginTop: 4, color: 'var(--cobalt)' }}>{fmtNum(d.summary.messages)}</div>
                <div className="meta">{d.summary.messages > 0 ? `${fmtMoney(d.summary.spend / d.summary.messages, cur, prefs.hide)} לשיחה` : 'אין שיחות'}</div>
              </div>
              <div className="card soft" style={{ padding: 12 }}>
                <div className="meta" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Eye size={13} />חשיפה (אנשים)</div>
                <div className="num" style={{ fontSize: 20, fontWeight: 500, marginTop: 4 }}>{fmtBig(d.summary.reach)}</div>
                <div className="meta">{fmtBig(d.summary.impressions)} הופעות · תדירות {d.summary.frequency.toFixed(2)}</div>
              </div>
              <div className="card soft" style={{ padding: 12 }}>
                <div className="meta" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Users size={13} />ביקורים בפרופיל</div>
                <div className="num" style={{ fontSize: 20, fontWeight: 500, marginTop: 4 }}>{fmtBig(d.summary.profileVisits)}</div>
                <div className="meta">{fmtBig(d.summary.landingPageViews)} צפיות בדף נחיתה</div>
              </div>
              <div className="card soft" style={{ padding: 12 }}>
                <div className="meta" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><MousePointerClick size={13} />קליקים</div>
                <div className="num" style={{ fontSize: 20, fontWeight: 500, marginTop: 4 }}>{fmtBig(d.summary.clicks)}</div>
                <div className="meta">CTR {d.summary.ctr.toFixed(2)}%</div>
              </div>
            </div>

            {/* Sub-tabs inside Client Drawer */}
            <PillTabs
              id="client-subtab"
              items={[
                { value: 'daily', label: 'פירוט יומי מלא', count: d.daily.length },
                { value: 'ads', label: 'מודעות', count: d.ads.length },
                { value: 'campaigns', label: 'קמפיינים', count: d.campaigns.length },
              ]}
              value={tab}
              onChange={setTab}
            />

            {tab === 'daily' && (
              <div className="stack" style={{ gap: 14 }}>
                {/* Interactive Daily Bar Chart */}
                <div className="card" style={{ padding: 16 }}>
                  <div className="chips" style={{ marginBottom: 12 }}>
                    {DAILY_METRICS.map((m) => (
                      <button key={m.value} className="chip" style={{ height: 30, fontSize: 12 }} aria-pressed={metric === m.value} onClick={() => setMetric(m.value)}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <ClientDailyChart days={d.daily} metric={metric} currency={cur} hide={prefs.hide} />
                </div>

                {/* Day-by-Day Table (Desktop) + Cards (Mobile) */}
                <div className="card flush">
                  <div style={{ padding: '14px 16px 8px' }}>
                    <b style={{ fontWeight: 500, fontSize: 15 }}>נתונים לפי יום ({shortDate(d.range.since)} – {shortDate(d.range.until)})</b>
                  </div>
                  <div className="scroll-x hide-sm">
                    <table className="table" style={{ fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th>תאריך</th>
                          <th className="num">לידים</th>
                          <th className="num">התכתבויות</th>
                          <th className="num">חשיפה</th>
                          <th className="num">הופעות</th>
                          <th className="num">ביקורי פרופיל</th>
                          <th className="num">קליקים</th>
                          <th className="num">הוצאה</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...d.daily].reverse().map((row) => (
                          <tr key={row.day}>
                            <td style={{ fontWeight: 500 }}>{shortDate(row.day)}</td>
                            <td className="num" style={{ color: row.leads > 0 ? 'var(--pos)' : undefined, fontWeight: row.leads > 0 ? 500 : 400 }}>{fmtNum(row.leads)}</td>
                            <td className="num" style={{ color: row.messages > 0 ? 'var(--cobalt)' : undefined, fontWeight: row.messages > 0 ? 500 : 400 }}>{fmtNum(row.messages)}</td>
                            <td className="num">{fmtBig(row.reach)}</td>
                            <td className="num">{fmtBig(row.impressions)}</td>
                            <td className="num">{fmtBig(row.profileVisits)}</td>
                            <td className="num">{fmtNum(row.clicks)}</td>
                            <td className="num" style={{ fontWeight: 500 }}>{fmtMoney(row.spend, cur, prefs.hide)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Day Cards */}
                  <div className="list show-sm">
                    {[...d.daily].reverse().map((row) => (
                      <div key={row.day} className="li" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                        <div className="spread">
                          <b style={{ fontWeight: 500 }}>{shortDate(row.day)}</b>
                          <span className="li-amount">{fmtMoney(row.spend, cur, prefs.hide)}</span>
                        </div>
                        <div className="li-meta" style={{ justifyContent: 'space-between' }}>
                          <span>לידים: <b>{fmtNum(row.leads)}</b></span>
                          <span>שיחות: <b>{fmtNum(row.messages)}</b></span>
                          <span>חשיפה: <b>{fmtBig(row.reach)}</b></span>
                          <span>פרופיל: <b>{fmtBig(row.profileVisits)}</b></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'ads' && (
              <div className="stack" style={{ gap: 12 }}>
                {d.ads.length === 0 ? (
                  <Empty icon={BarChart3} title="אין מודעות עם הוצאה בטווח הזה" />
                ) : (
                  <div className="list inset">
                    {d.ads.map((ad) => {
                      const isWinner = d.winners.some((w) => w.id === ad.id);
                      const isBleeding = d.bleeding.some((b) => b.id === ad.id);
                      return (
                        <div key={ad.id} className="li" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                          <div className="spread" style={{ alignItems: 'flex-start', gap: 8 }}>
                            <div className="li-main">
                              <div className="li-title" dir="auto">{ad.name}</div>
                              <div className="li-meta">
                                {ad.campaignName && <span>{ad.campaignName} · </span>}
                                <span>{ad.leads > 0 ? `${fmtNum(ad.leads)} לידים` : ad.messages > 0 ? `${fmtNum(ad.messages)} שיחות` : `${fmtNum(ad.primaryResults)} תוצאות`}</span>
                                <span>· {fmtBig(ad.impressions)} הופעות</span>
                                <span>· CTR {ad.ctr.toFixed(2)}%</span>
                                <span>· תדירות {ad.frequency.toFixed(2)}</span>
                              </div>
                            </div>
                            <span className="li-amount">{fmtMoney(ad.spend, cur, prefs.hide)}</span>
                          </div>
                          <div className="spread wrap" style={{ gap: 8 }}>
                            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                              <Badge kind={ad.status === 'ACTIVE' ? 'pos' : 'none'} icon={false}>
                                {ad.status === 'ACTIVE' ? 'פעילה' : 'מושהית'}
                              </Badge>
                              {isWinner && <Badge kind="pos">מנצחת</Badge>}
                              {isBleeding && <Badge kind="neg">שורפת תקציב</Badge>}
                              {ad.costPerResult != null && (
                                <span className="meta num">{fmtMoney(ad.costPerResult, cur, prefs.hide)} לתוצאה</span>
                              )}
                            </div>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ height: 30, paddingInline: 12, fontSize: 12 }}
                              disabled={busyAd === ad.id}
                              onClick={() => toggleAdStatus(ad)}
                            >
                              {ad.status === 'ACTIVE' ? <><Pause size={12} />השהה</> : <><Play size={12} />הפעל</>}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === 'campaigns' && (
              <div className="list inset">
                {d.campaigns.length === 0 ? (
                  <Empty icon={BarChart3} title="אין קמפיינים פעילים בטווח" />
                ) : (
                  d.campaigns.map((c) => (
                    <div key={c.id} className="li">
                      <div className="li-main">
                        <div className="li-title" dir="auto">{c.name}</div>
                        <div className="li-meta">
                          <span>לידים: <b>{fmtNum(c.leads)}</b></span>
                          <span>· שיחות: <b>{fmtNum(c.messages)}</b></span>
                          <span>· חשיפה: {fmtBig(c.reach)}</span>
                          <span>· פרופיל: {fmtBig(c.profileVisits)}</span>
                        </div>
                      </div>
                      <div className="li-end" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                        <span className="li-amount">{fmtMoney(c.spend, cur, prefs.hide)}</span>
                        {c.costPerResult != null && <span className="meta num">{fmtMoney(c.costPerResult, cur, prefs.hide)} / תוצאה</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

/* ================= Interactive Daily Bar Chart ================= */
function ClientDailyChart({
  days,
  metric,
  currency,
  hide,
}: {
  days: DayRow[];
  metric: DailyMetricKey;
  currency: string;
  hide: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const meta = DAILY_METRICS.find((m) => m.value === metric) ?? DAILY_METRICS[0];
  const vals = days.map((d) => (metric === 'impressions' ? d.impressions : (d[metric] as number) || 0));
  const max = Math.max(1, ...vals);
  const W = 560, H = 156, padB = 22, padT = 8;
  const slot = W / Math.max(1, days.length);
  const bw = Math.max(3, Math.min(20, slot * 0.64));
  const h = (v: number) => ((H - padB - padT) * v) / max;
  const idx = hover ?? days.length - 1;
  const activeDay = days[idx];
  const labelEvery = Math.max(1, Math.ceil(days.length / 7));

  return (
    <div>
      {activeDay && (
        <div className="spread wrap" style={{ marginBottom: 8, fontSize: 12.5 }}>
          <span className="meta">{shortDate(activeDay.day)}</span>
          <span className="num" style={{ fontWeight: 500 }}>
            {metric === 'spend'
              ? fmtMoney(activeDay.spend, currency, hide)
              : metric === 'impressions'
                ? `${fmtBig(activeDay.impressions)} הופעות (${fmtBig(activeDay.reach)} חשיפה)`
                : `${fmtNum(activeDay[metric] as number)} ${meta.label}`}
          </span>
        </div>
      )}
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} style={{ direction: 'ltr' }} role="img" aria-label={meta.label}>
        {[0.5, 1].map((t) => (
          <line key={t} x1="0" x2={W} y1={H - padB - h(max * t)} y2={H - padB - h(max * t)} stroke="var(--line)" strokeDasharray="2 5" />
        ))}
        {days.map((d, k) => {
          const cx = W - (slot * k + slot / 2);
          const v = vals[k];
          const barH = Math.max(v > 0 ? 3 : 0, h(v));
          return (
            <g
              key={d.day}
              onMouseEnter={() => setHover(k)}
              onMouseLeave={() => setHover(null)}
              onTouchStart={() => setHover(k)}
              opacity={hover == null || hover === k ? 1 : 0.45}
            >
              <rect x={cx - slot / 2} y="0" width={slot} height={H} fill="transparent" />
              <rect x={cx - bw / 2} y={H - padB - barH} width={bw} height={barH} rx={Math.min(4, bw / 2)} fill={meta.color} />
              {(days.length - 1 - k) % labelEvery === 0 && (
                <text x={cx} y={H - 5} textAnchor="middle">{d.day.slice(8, 10)}/{d.day.slice(5, 7)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MorningRing({ winners, alerts, active }: { winners: number; alerts: number; active: number }) {
  const total = Math.max(1, active);
  const wDash = Math.round((winners / total) * 75);
  const aDash = Math.round((alerts / total) * 56);
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="12" fill="none" stroke="var(--line)" strokeWidth="3" />
      <circle cx="16" cy="16" r="12" fill="none" stroke="var(--g-green)" strokeWidth="3" strokeDasharray={`${wDash} 80`} strokeLinecap="round" transform="rotate(-90 16 16)" />
      <circle cx="16" cy="16" r="7.5" fill="none" stroke="var(--line)" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="7.5" fill="none" stroke="var(--neg)" strokeWidth="2.5" strokeDasharray={`${aDash} 50`} strokeLinecap="round" transform="rotate(-90 16 16)" />
    </svg>
  );
}

/* ================= Live Agent Chat Drawer ================= */
function AgentChatSheet({ open, onClose, onMutated }: { open: boolean; onClose: () => void; onMutated: () => void }) {
  const [msgs, setMsgs] = useState<Array<{ role: 'user' | 'model'; text: string }>>([
    {
      role: 'model',
      text: 'היי אביהו! אני מחובר בלייב לחשבונות המודעות של אדיג׳יטל. אפשר לשאול אותי על כל לקוח, לבקש ניתוח עומק או להורות לי לבצע פעולה במטא (למשל: "תשהה את סרטון 20% במונה מדיקל" או "תעלה תקציב ב-20% באיזי ריזולטס").',
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || sending) return;
    setInput('');
    const nextHistory = [...msgs, { role: 'user' as const, text }];
    setMsgs(nextHistory);

    if (DEMO) {
      setMsgs((m) => [
        ...m,
        {
          role: 'model',
          text: 'אנחנו כרגע במצב הדגמה מקומי. באתר האונליין (עם META_ADS_ACCESS_TOKEN ו-GEMINI_API_KEY) אני שולף נתונים חיים מ-Meta ומבצע השהיות ושינויי תקציב עם אימות Read-back מיידי.',
        },
      ]);
      return;
    }

    setSending(true);
    try {
      const res = await api<{ reply: string; executedReceipts?: VerifiedActionLog[] }>('/api/marketing', {
        method: 'POST',
        body: { action: 'agent_chat', message: text, history: msgs },
      });
      setMsgs((m) => [...m, { role: 'model', text: res.reply }]);
      if (res.executedReceipts?.length) onMutated();
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'model', text: `שגיאה: ${e.message || 'לא הצלחתי להשלים את הבקשה'}` }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="צ׳אט חי עם סוכן הקמפיינים">
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div className="chips" style={{ padding: '6px 20px 10px' }}>
          {[
            'אילו מודעות הכי דחוף לעצור היום?',
            'תן לי סיכום על ospa מודיעין ב-7 ימים',
            'איפה הכי כדאי להגדיל תקציב השבוע?',
          ].map((q) => (
            <button key={q} className="chip" style={{ height: 30, fontSize: 12 }} onClick={() => send(q)} disabled={sending}>
              {q}
            </button>
          ))}
        </div>
        <div className="chat" style={{ flex: 1 }}>
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.role === 'user' ? 'out' : 'in'}`} dir="auto">
              {m.text}
            </div>
          ))}
          {sending && <div className="bubble in meta">בודק מול שרתי Meta…</div>}
        </div>
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            className="input"
            style={{ height: 44, borderRadius: 999, flex: 1 }}
            placeholder="כתוב הוראה או שאלה לסוכן…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" style={{ height: 44, paddingInline: 16 }} disabled={sending || !input.trim()}>
            <Send size={16} />
          </button>
        </form>
      </div>
    </Sheet>
  );
}

/* ================= Demo Mode Fallback (Realistic Adigital Data) ================= */
function buildDemoOverview(days: number): OverviewPayload {
  const scale = days / 7;
  const accounts: AccountItem[] = [
    {
      accountId: '1976885606385451',
      name: 'ospa מודיעין - חשבון מודעות',
      business: 'O spa - ספא ראש',
      currency: 'ILS',
      spend: Math.round(2642 * scale),
      impressions: Math.round(63436 * scale),
      reach: Math.round(40320 * scale),
      clicks: Math.round(2945 * scale),
      ctr: 4.64,
      cpm: 41.6,
      frequency: 1.57,
      leads: Math.round(277 * scale),
      messages: Math.round(149 * scale),
      profileVisits: Math.round(610 * scale),
      landingPageViews: Math.round(189 * scale),
      purchases: 3,
      primaryResults: Math.round(277 * scale),
      resultType: 'לידים',
      costPerResult: 9.54,
      health: 'winner',
      statusLabel: 'מנצח ויציב',
      winners: [
        { id: '120238971903150162', name: 'מודעה 2 · וידאו טיפול ראש', status: 'ACTIVE', spend: 92, impressions: 3200, reach: 2400, clicks: 347, ctr: 10.86, frequency: 1.37, leads: 16, messages: 10, profileVisits: 44, primaryResults: 16, resultType: 'לידים', costPerResult: 5.75 },
        { id: '120232298252290162', name: 'מודעה 1 · קמפיין ראשי', status: 'ACTIVE', spend: 504, impressions: 14100, reach: 12050, clicks: 868, ctr: 6.16, frequency: 1.17, leads: 64, messages: 46, profileVisits: 130, primaryResults: 64, resultType: 'לידים', costPerResult: 7.87 },
      ],
      bleeding: [
        { id: '120246944350340162', name: 'מודעת לידים חדשה', status: 'ACTIVE', spend: 135, impressions: 4100, reach: 3150, clicks: 135, ctr: 3.3, frequency: 1.3, leads: 4, messages: 3, profileVisits: 18, primaryResults: 4, resultType: 'לידים', costPerResult: 33.68 },
      ],
    },
    {
      accountId: '2082215055297480',
      name: 'מונה מדיקל 2023',
      business: 'Mona Medical',
      currency: 'ILS',
      spend: Math.round(2465 * scale),
      impressions: Math.round(38282 * scale),
      reach: Math.round(14945 * scale),
      clicks: Math.round(1409 * scale),
      ctr: 3.68,
      cpm: 64.4,
      frequency: 2.56,
      leads: Math.round(57 * scale),
      messages: 0,
      profileVisits: Math.round(312 * scale),
      landingPageViews: Math.round(620 * scale),
      purchases: 0,
      primaryResults: Math.round(57 * scale),
      resultType: 'לידים',
      costPerResult: 43.24,
      health: 'alert',
      statusLabel: '2 מודעות יקרות',
      winners: [
        { id: '120250857638690069', name: 'מאוחדת | וידאו 2', status: 'ACTIVE', spend: 304, impressions: 6400, reach: 3650, clicks: 446, ctr: 6.97, frequency: 1.75, leads: 23, messages: 0, profileVisits: 80, primaryResults: 23, resultType: 'לידים', costPerResult: 13.21 },
      ],
      bleeding: [
        { id: '120250867280810069', name: 'סרטון מודעה 20% | וידאו', status: 'ACTIVE', spend: 269, impressions: 5100, reach: 2470, clicks: 154, ctr: 3.03, frequency: 2.06, leads: 2, messages: 0, profileVisits: 22, primaryResults: 2, resultType: 'לידים', costPerResult: 134.26 },
        { id: '120250857641500069', name: 'רימרקטינג | וידאו 2', status: 'ACTIVE', spend: 95, impressions: 1850, reach: 1060, clicks: 87, ctr: 4.73, frequency: 1.75, leads: 0, messages: 0, profileVisits: 14, primaryResults: 0, resultType: 'לידים', costPerResult: null },
      ],
    },
    {
      accountId: '8939187936207591',
      name: 'באלנס רחובות - תקין',
      business: 'רשת באלנס',
      currency: 'ILS',
      spend: Math.round(924 * scale),
      impressions: Math.round(38810 * scale),
      reach: Math.round(6333 * scale),
      clicks: Math.round(462 * scale),
      ctr: 1.19,
      cpm: 23.8,
      frequency: 6.13,
      leads: 2,
      messages: Math.round(40 * scale),
      profileVisits: Math.round(190 * scale),
      landingPageViews: 0,
      purchases: 0,
      primaryResults: Math.round(40 * scale),
      resultType: 'התכתבויות',
      costPerResult: 23.09,
      health: 'alert',
      statusLabel: 'שחיקה (6.1)',
      winners: [],
      bleeding: [
        { id: '120253907905430421', name: 'שחור | נוסח ב - עותק', status: 'ACTIVE', spend: 58, impressions: 2100, reach: 1580, clicks: 45, ctr: 2.18, frequency: 1.33, leads: 0, messages: 1, profileVisits: 9, primaryResults: 1, resultType: 'התכתבויות', costPerResult: 57.76 },
      ],
    },
    {
      accountId: '3252134508266879',
      name: 'איזי ריזולטס',
      business: 'Easy result - מודיעין',
      currency: 'ILS',
      spend: Math.round(639 * scale),
      impressions: Math.round(9737 * scale),
      reach: Math.round(6294 * scale),
      clicks: Math.round(256 * scale),
      ctr: 2.63,
      cpm: 65.6,
      frequency: 1.55,
      leads: Math.round(27 * scale),
      messages: 0,
      profileVisits: Math.round(95 * scale),
      landingPageViews: 0,
      purchases: 0,
      primaryResults: Math.round(27 * scale),
      resultType: 'לידים',
      costPerResult: 23.67,
      health: 'winner',
      statusLabel: 'מנצח ויציב',
      winners: [],
      bleeding: [],
    },
  ];

  return {
    configured: true,
    range: { since: isoAgo(days - 1), until: isoAgo(0), days },
    totals: {
      spend: accounts.reduce((s, a) => s + a.spend, 0),
      impressions: accounts.reduce((s, a) => s + a.impressions, 0),
      reach: accounts.reduce((s, a) => s + a.reach, 0),
      clicks: accounts.reduce((s, a) => s + a.clicks, 0),
      leads: accounts.reduce((s, a) => s + a.leads, 0),
      messages: accounts.reduce((s, a) => s + a.messages, 0),
      profileVisits: accounts.reduce((s, a) => s + a.profileVisits, 0),
      purchases: 3,
      activeCount: accounts.length,
      alertCount: 2,
      winnerCount: 2,
    },
    accounts,
    skippedConditionalCount: 5,
    agentSummary: 'מצב הדגמה: במונה מדיקל ובאלנס רחובות זוהו מודעות יקרות ושחיקת תדירות (6.13), בעוד ש-Ospa מודיעין ואיזי ריזולטס מציגים עלות לליד מצוינת ובשלים להגדלת תקציב.',
    agentLastRunAt: new Date().toISOString(),
    recommendations: [
      { id: 'd1', accountId: '2082215055297480', accountName: 'מונה מדיקל 2023', kind: 'pause_ad', priority: 'high', title: 'עצירת מודעה יקרה · מונה מדיקל', reason: '"סרטון מודעה 20% | וידאו" בעלות ₪134.2 לליד לעומת ₪13.2 במודעה המנצחת.', impactIls: 269, targetEntityId: '120250867280810069', targetEntityName: 'סרטון מודעה 20% | וידאו', state: 'pending' },
      { id: 'd2', accountId: '8939187936207591', accountName: 'באלנס רחובות - תקין', kind: 'creative_refresh', priority: 'high', title: 'רענון קריאייטיב · באלנס רחובות', reason: 'תדירות החשיפה עלתה ל-6.13 — נדרש סרטון UGC חדש לשבירת שחיקת הקהל.', impactIls: 215, state: 'pending' },
      { id: 'd3', accountId: '3252134508266879', accountName: 'איזי ריזולטס', kind: 'scale_budget', priority: 'medium', title: 'הגדלת תקציב +20% · איזי ריזולטס', reason: '27 לידים ב-₪23.7 ותדירות נמוכה של 1.55.', impactIls: 130, state: 'pending' },
    ],
  };
}

function buildDemoAccountDetail(acc: AccountItem, days: number): AccountDetailPayload {
  const daily: DayRow[] = Array.from({ length: days }, (_, i) => {
    const day = isoAgo(days - 1 - i);
    const wave = 0.7 + 0.45 * Math.abs(Math.sin(i * 0.9 + Number(acc.accountId.slice(-2))));
    const spend = Math.round((acc.spend / days) * wave);
    const leads = Math.round((acc.leads / days) * wave);
    const messages = Math.round((acc.messages / days) * wave);
    const impressions = Math.round((acc.impressions / days) * wave);
    const reach = Math.round(impressions / Math.max(1.1, acc.frequency * 0.5));
    const profileVisits = Math.round((acc.profileVisits / days) * wave);
    const clicks = Math.round((acc.clicks / days) * wave);
    const primaryResults = leads >= messages ? leads : messages;
    return {
      day,
      spend,
      impressions,
      reach,
      clicks,
      ctr: impressions ? (clicks / impressions) * 100 : 0,
      frequency: reach ? impressions / reach : 1,
      leads,
      messages,
      profileVisits,
      landingPageViews: Math.round(clicks * 0.35),
      primaryResults,
      resultType: acc.resultType,
      costPerResult: primaryResults ? spend / primaryResults : null,
    };
  });

  return {
    accountId: acc.accountId,
    name: acc.name,
    currency: acc.currency,
    range: { since: daily[0].day, until: daily[daily.length - 1].day, days },
    summary: {
      spend: acc.spend,
      impressions: acc.impressions,
      reach: acc.reach,
      clicks: acc.clicks,
      ctr: acc.ctr,
      frequency: acc.frequency,
      leads: acc.leads,
      messages: acc.messages,
      profileVisits: acc.profileVisits,
      landingPageViews: acc.landingPageViews,
      primaryResults: acc.primaryResults,
      resultType: acc.resultType,
      costPerResult: acc.costPerResult,
    },
    daily,
    campaigns: [
      { id: 'c1', name: `קמפיין ראשי · ${acc.name}`, spend: Math.round(acc.spend * 0.72), impressions: Math.round(acc.impressions * 0.7), reach: Math.round(acc.reach * 0.7), clicks: Math.round(acc.clicks * 0.74), ctr: acc.ctr, frequency: acc.frequency, leads: Math.round(acc.leads * 0.78), messages: Math.round(acc.messages * 0.78), profileVisits: Math.round(acc.profileVisits * 0.7), landingPageViews: 0, primaryResults: Math.round(acc.primaryResults * 0.78), resultType: acc.resultType, costPerResult: acc.costPerResult },
      { id: 'c2', name: `רימרקטינג · ${acc.name}`, spend: Math.round(acc.spend * 0.28), impressions: Math.round(acc.impressions * 0.3), reach: Math.round(acc.reach * 0.3), clicks: Math.round(acc.clicks * 0.26), ctr: acc.ctr * 0.9, frequency: acc.frequency * 1.2, leads: Math.round(acc.leads * 0.22), messages: Math.round(acc.messages * 0.22), profileVisits: Math.round(acc.profileVisits * 0.3), landingPageViews: 0, primaryResults: Math.round(acc.primaryResults * 0.22), resultType: acc.resultType, costPerResult: acc.costPerResult ? acc.costPerResult * 1.25 : null },
    ],
    ads: [...acc.winners, ...acc.bleeding],
    winners: acc.winners,
    bleeding: acc.bleeding,
  };
}
