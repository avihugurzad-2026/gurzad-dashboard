import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Briefcase, Building2, CalendarDays, ChevronLeft, CircleAlert, CircleCheck, Home, Wallet } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { alerts, bizSummary, homeMonth, homeTrend, portfolio, upcoming } from '../data/derive';
import { useCollection, useDerived } from '../data/store';
import { greeting, money, moneyRaw, percent, relDay, shortDate } from '../lib/format';
import { usePrefs } from '../lib/prefs';
import { Card, DotNum, Empty, Kpi, Meter, PageHead, Stagger, Badge } from '../ui/kit';
import { DotStrip, Spark } from '../ui/charts';
import { HomeSchedule } from './Planner';

const TONE = { home: 'var(--tone-home)', business: 'var(--tone-business)', invest: 'var(--tone-invest)' } as const;
const AREA_LABEL = { home: 'בית', business: 'עסקים', invest: 'השקעות' } as const;

export function Overview() {
  const { user } = useAuth();
  const nav = useNavigate();
  const prefs = usePrefs();
  const businesses = useCollection('businesses');
  const d = useDerived(() => {
    const hm = homeMonth();
    const trend = homeTrend();
    const biz = businesses.map((b) => ({ b, s: bizSummary(b.id) }));
    const pf = portfolio();
    const bizProfit = biz.reduce((a, x) => a + x.s.cur.profit * ((x.b.owner_pct ?? 100) / 100), 0);
    const bizProfitPrev = biz.reduce((a, x) => a + x.s.prev.profit * ((x.b.owner_pct ?? 100) / 100), 0);
    return { hm, trend, biz, pf, bizProfit, bizProfitPrev, list: alerts(), up: upcoming(14), up30: upcoming(30) };
  }, [businesses, prefs.hide]);

  const net = d.hm.income - d.hm.spent;
  const shown = d.list.slice(0, 7);
  const urgent = d.list.filter((a) => a.level === 'danger').length;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 30 }, (_, i) => {
    const dt = new Date(today); dt.setDate(dt.getDate() + i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    return d.up30.filter((u) => (u.date || '').slice(0, 10) === key).slice(0, 4);
  });
  const week = d.up30.filter((u) => { const t = new Date(u.date).getTime() - today.getTime(); return t >= 0 && t < 7 * 864e5; }).length;

  return (
    <>
      <PageHead title={<>{greeting()}, {user?.name}</>} sub={d.list.length ? `${d.list.length} דברים מחכים לך היום. כל השאר בשליטה.` : 'הכול תקין. אין שום דבר דחוף.'} />

      <div className="statline">
        <span className="stat"><b>{d.list.length + d.up.length}</b><span className="badge lime">סה״כ פתוחים</span></span>
        <Link to="/home/tasks" className="stat"><b>{d.up.length}</b><span className="badge">ב־14 הימים הקרובים</span></Link>
        <span className="stat"><b>{d.list.length - urgent}</b><span className="badge">למעקב</span></span>
        <span className="stat"><b>{urgent}</b><span className="badge">דחוף</span></span>
      </div>
      <div className="daystrip" role="img" aria-label={`30 הימים הקרובים: ${d.up30.length} אירועים, מתוכם ${week} השבוע`}>
        <div className="days">
          {days.map((evs, i) => (
            <span key={i} className={`day ${i === 0 ? 'today' : ''}`}>
              {evs.length === 0 ? <i /> : evs.map((u) => <i key={u.id} className={u.area === 'home' ? 'ok' : u.area === 'business' ? 'p' : 'a'} />)}
            </span>
          ))}
        </div>
        <Link to="/planner/month" className="trend" style={{ color: 'inherit' }}><CalendarDays size={15} />{week}<span>אירועים השבוע</span></Link>
      </div>

      <Stagger>
        {/* Today's agenda and this week, straight from the planner */}
        <HomeSchedule />

        {/* Hero: household cash flow this month */}
        <Card className="hero lg-5 md-12" style={{ padding: 'var(--s-6)' }}>
          <div className="spread">
            <span className="hero-label"><Wallet size={16} />תזרים הבית החודש</span>
            <span className="hero-chip">{net >= 0 ? 'בפלוס' : 'במינוס'}</span>
          </div>
          <div className="hero-num">
            <DotNum value={prefs.hide ? '•••' : moneyRaw(Math.abs(net)).replace(/\s/g, '')} label={money(net)} />
          </div>
          <div className="hero-sub">נכנסו {money(d.hm.income)} · יצאו {money(d.hm.spent)}</div>
          <div style={{ marginTop: 18, opacity: 0.9 }}><DotStrip values={d.trend.flatMap((t) => [t.income, t.spent, 0]).slice(0, -1)} /></div>
        </Card>

        {/* Attention */}
        <Card className="flush lg-7 md-12">
          <div className="card-head" style={{ padding: '20px 20px 0', marginBottom: 8 }}>
            <div><h2>דורש תשומת לב</h2><div className="sub">ממוין לפי דחיפות</div></div>
            {d.list.length > 7 && <span className="meta">ועוד {d.list.length - 7}</span>}
          </div>
          {shown.length === 0 ? <Empty icon={CircleCheck} title="הכול תקין" text="אין תשלומים באיחור, חוזים שמסתיימים או משימות תקועות." /> : (
            <div className="list">
              {shown.map((a) => (
                <button key={a.id} className="li clickable" style={{ width: '100%', textAlign: 'start' }} onClick={() => nav(a.to)}>
                  <span className="li-icon" style={{ color: a.level === 'danger' ? 'var(--neg)' : 'var(--warn)', background: a.level === 'danger' ? 'var(--neg-bg)' : 'var(--warn-bg)' }}>
                    {a.level === 'danger' ? <CircleAlert size={18} /> : <AlertTriangle size={18} />}
                  </span>
                  <span className="li-main">
                    <span className="li-title" style={{ display: 'block' }}>{a.title}</span>
                    <span className="li-meta">{a.detail}</span>
                  </span>
                  <span className="li-end"><span className="badge hide-sm" style={{ color: TONE[a.area] }}>{AREA_LABEL[a.area]}</span><ChevronLeft size={16} className="muted" /></span>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* One card per area */}
        <Card className="lg-4 md-6" to="/home">
          <Kpi label="בית · הוצאות החודש" icon={Home} tone={TONE.home} value={money(d.hm.spent)}
            foot={d.hm.budget ? <>מתוך תקציב {money(d.hm.budget)}</> : 'לא הוגדר תקציב'} />
          <div style={{ marginTop: 14 }}><Meter value={d.hm.spent} max={d.hm.budget || d.hm.spent || 1} tone={TONE.home} /></div>
        </Card>

        <Card className="lg-4 md-6" to="/business">
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <Kpi label="עסקים · הרווח שלי החודש" icon={Briefcase} tone={TONE.business} value={businesses.length ? money(d.bizProfit) : 'אין נתונים עדיין'}
              delta={d.bizProfitPrev ? (d.bizProfit - d.bizProfitPrev) / Math.abs(d.bizProfitPrev) : null} foot="מול חודש קודם" />
            <span className="hide-md"><Spark values={d.biz[0]?.s.series.map((_, i) => d.biz.reduce((a, x) => a + x.s.series[i].profit * ((x.b.owner_pct ?? 100) / 100), 0)) ?? []} /></span>
          </div>
          <div className="chips" style={{ marginTop: 14 }}>
            {d.biz.map(({ b, s }) => <Badge key={b.id} kind={s.overdue.length ? 'warn' : 'none'}>{b.name}{s.overdue.length ? ` · ${s.overdue.length} באיחור` : ''}</Badge>)}
          </div>
        </Card>

        <Card className="lg-4 md-12" to="/invest">
          <Kpi label="נכסים · שכירות שנגבתה החודש" icon={Building2} tone={TONE.invest} value={d.pf.props.length ? money(d.pf.collected) : 'אין נתונים עדיין'}
            foot={<>מתוך {money(d.pf.expected)} · תפוסה {percent(d.pf.occupancy)}</>} />
          <div style={{ marginTop: 14 }}><Meter value={d.pf.collected} max={d.pf.expected || 1} tone={TONE.invest} /></div>
        </Card>

        {/* Upcoming */}
        <Card className="flush lg-12">
          <div className="card-head" style={{ padding: '20px 20px 0', marginBottom: 8 }}>
            <div><h2>14 הימים הקרובים</h2><div className="sub">תשלומים, גבייה ומשימות</div></div>
            <Link className="card-link" to="/planner/week">ליומן<ChevronLeft size={14} /></Link>
          </div>
          {d.up.length === 0 ? <Empty icon={CalendarDays} title="לוח פנוי" text="אין מועדים בשבועיים הקרובים." /> : (
            <div className="list">
              {d.up.slice(0, 9).map((u) => (
                <Link key={u.id} to={u.to} className="li clickable" style={{ color: 'inherit' }}>
                  <span className="li-icon num" style={{ flexDirection: 'column', lineHeight: 1, width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TONE[u.area] }}>
                    <b style={{ fontSize: 16, fontWeight: 700 }}>{shortDate(u.date).split(' ')[0]}</b>
                    <span style={{ fontSize: 10 }}>{shortDate(u.date).split(' ').slice(1).join(' ')}</span>
                  </span>
                  <span className="li-main"><span className="li-title" style={{ display: 'block' }}>{u.title}</span><span className="li-meta">{u.meta} · {relDay(u.date)}</span></span>
                  {u.amount != null && <span className="li-amount">{money(u.amount)}</span>}
                </Link>
              ))}
            </div>
          )}
        </Card>
      </Stagger>
    </>
  );
}
