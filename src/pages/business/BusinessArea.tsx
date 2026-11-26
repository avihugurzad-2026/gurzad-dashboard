import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Award, Banknote, Briefcase, CircleAlert, FileText, LayoutGrid, ListChecks, Megaphone, Pencil, Plus, Receipt, TrendingUp, Users, Wallet } from 'lucide-react';
import { isAdigitalBusiness } from './MetaCampaignsPage';
import { RevenueView } from './IntegrationsPanel';
import { TeamView } from './TeamView';
import { externalExpense, externalIncome, useBizOps, useBizRevenue } from '../../lib/bizRevenue';
import type { Rec } from '../../data/types';
import { useCollection, useDerived, store } from '../../data/store';
import { bizSummary, gross, invoiceState, needsAllocation, vatRate } from '../../data/derive';
import { daysUntil, money, percent, shortDate } from '../../lib/format';
import { usePrefs } from '../../lib/prefs';
import { AddButton, useCrud } from '../../ui/crud';
import { BarChart } from '../../ui/charts';
import { Badge, Card, CardHead, Empty, Kpi, Meter, PageHead, PillTabs, Stagger, TabBody, spring } from '../../ui/kit';
import { RecordList, TaskList } from '../../ui/lists';

const TONE = 'var(--tone-business)';
const TABS = [
  { value: 'overview', label: 'מצב כספי', icon: LayoutGrid },
  { value: 'team', label: 'צוות ומכירות', icon: Award },
  { value: 'invoices', label: 'חשבוניות', icon: FileText },
  { value: 'clients', label: 'לקוחות', icon: Users },
  { value: 'expenses', label: 'הוצאות', icon: Receipt },
  { value: 'tasks', label: 'משימות', icon: ListChecks },
] as const;
type Tab = (typeof TABS)[number]['value'];

/** The tabs a business can show (the owner hides some in Settings → העסקים שלי). */
export function bizTabs(isAgency: boolean) {
  const tabs: { value: string; label: string; icon: typeof LayoutGrid }[] = [...TABS];
  if (isAgency) tabs.splice(4, 0, { value: 'meta-campaigns', label: 'ניהול קמפיינים במטא', icon: Megaphone });
  return tabs;
}

export function BusinessArea() {
  const { bizId, tab = 'overview' } = useParams();
  const nav = useNavigate();
  const businesses = useCollection('businesses');
  const bizCrud = useCrud('businesses');
  const biz = businesses.find((b) => b.id === bizId) ?? businesses[0];

  useEffect(() => { if (!bizId && biz) nav(`/business/${biz.id}`, { replace: true }); }, [bizId, biz, nav]);

  if (!biz) return (
    <>
      <PageHead tag="ניהול עסקים" tone={TONE} title="העסקים" />
      <Stagger><Card className="lg-12"><Empty icon={Briefcase} title="עוד אין עסקים" text="הוסף את העסק הראשון. כל עסק מקבל מצב כספי, חשבוניות, לקוחות, הוצאות ומשימות משלו." action={<AddButton label="עסק חדש" onClick={() => bizCrud.openNew()} />} /></Card></Stagger>
      {bizCrud.sheet}
    </>
  );

  const isAgency = isAdigitalBusiness(biz);
  const hidden: string[] = Array.isArray(biz.hidden_tabs) ? biz.hidden_tabs : [];
  const tabsForBiz = bizTabs(isAgency).filter((t) => t.value === 'overview' || !hidden.includes(t.value));
  const View = hidden.includes(tab) ? BizOverview : ({ overview: BizOverview, team: TeamView, invoices: Invoices, clients: Clients, expenses: Expenses, tasks: BizTasks }[tab as Tab] ?? BizOverview);

  return (
    <>
      <PageHead tag="ניהול עסקים" tone={TONE} title={biz.name} sub={<>{biz.kind}{biz.owner_pct != null && biz.owner_pct < 100 ? ` · החלק שלי ${biz.owner_pct}%` : ''}</>}>
        {isAgency && !hidden.includes('meta-campaigns') && (
          <button className="btn btn-primary" onClick={() => nav(`/business/${biz.id}/meta-campaigns`)}>
            <Megaphone size={15} />ניהול קמפיינים במטא
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => bizCrud.openEdit(biz)}><Pencil size={15} />פרטי העסק</button>
      </PageHead>

      {/* business switcher */}
      <div className="chips" style={{ marginBottom: 14 }} role="group" aria-label="בחירת עסק">
        {businesses.map((b) => {
          const on = b.id === biz.id;
          return (
            <button key={b.id} aria-pressed={on} className="chip" style={{ position: 'relative', background: on ? 'transparent' : undefined, borderColor: on ? 'transparent' : undefined }} onClick={() => nav(`/business/${b.id}${tab !== 'overview' ? '/' + tab : ''}`)}>
              {on && <motion.span layoutId="biz-chip" transition={spring} style={{ position: 'absolute', inset: -1, borderRadius: 999, background: 'var(--accent)' }} />}
              <span className="chip-text" title={b.name}>{b.name}</span>
            </button>
          );
        })}
        <button className="chip" onClick={() => bizCrud.openNew()} style={{ borderStyle: 'dashed' }}><Plus size={14} />עסק חדש</button>
      </div>

      <div className="subnav"><PillTabs id="biz" items={tabsForBiz} value={tab as any} onChange={(v) => nav(v === 'meta-campaigns' ? `/business/${biz.id}/meta-campaigns` : `/business/${biz.id}${v === 'overview' ? '' : '/' + v}`)} /></div>
      <TabBody id={biz.id + tab}><View biz={biz} /></TabBody>
      {bizCrud.sheet}
    </>
  );
}

/* ================= Overview ================= */
function BizOverview({ biz }: { biz: Rec }) {
  const prefs = usePrefs();
  const nav = useNavigate();
  const partial = (biz.owner_pct ?? 100) < 100;
  const [mine, setMine] = useState(partial);
  useEffect(() => setMine(partial), [biz.id, partial]);
  const revs = useBizRevenue(biz.id);
  const ops = useBizOps(biz.id);
  const ext = useMemo(() => externalIncome(revs, vatRate), [revs]);
  const extExp = useMemo(() => externalExpense(ops), [ops]);
  const s = useDerived(() => bizSummary(biz.id, ext, extExp), [biz.id, prefs.hide, ext, extExp]);
  const k = mine ? (biz.owner_pct ?? 100) / 100 : 1;
  const src = revs.map((r) => r.name).join(' + ');
  const synced = revs.map((r) => r.lastSyncAt).filter(Boolean).sort().pop();
  const d = (a: number, b: number) => (b ? (a - b) / Math.abs(b) : null);
  const hasData = s.series.some((m) => m.income || m.expense);
  const x = useDerived(() => {
    const inv = store.all('invoices').filter((i) => i.business_id === biz.id && i.status !== 'בוטלה' && i.status !== 'טיוטה');
    const open = inv.filter((i) => i.status !== 'שולמה');
    const late = (i: Rec) => (i.due_date ? -daysUntil(i.due_date) : 0);
    const bucket = (label: string, tone: string, f: (n: number) => boolean) => { const rows = open.filter((i) => f(late(i))); return { label, tone, count: rows.length, total: rows.reduce((a, i) => a + gross(i), 0) }; };
    const aging = [
      bucket('עוד לא הגיע המועד', 'var(--ink)', (n) => n <= 0),
      bucket('עד 30 ימים באיחור', 'var(--warn)', (n) => n > 0 && n <= 30),
      bucket('31 עד 60 ימים', 'var(--g-orange)', (n) => n > 30 && n <= 60),
      bucket('מעל 60 ימים', 'var(--neg)', (n) => n > 60),
    ];
    const since = new Date(); since.setFullYear(since.getFullYear() - 1);
    const from = since.toISOString().slice(0, 10);
    const by = new Map<string, { name: string; total: number; count: number; open: number }>();
    inv.filter((i) => (i.issue_date || '') >= from).forEach((i) => {
      const c = by.get(i.client) ?? { name: i.client || 'ללא שם', total: 0, count: 0, open: 0 };
      c.total += i.amount_net || 0; c.count++; if (i.status !== 'שולמה') c.open += gross(i);
      by.set(i.client, c);
    });
    const all = [...by.values()].sort((a, b) => b.total - a.total);
    const sumAll = all.reduce((a, c) => a + c.total, 0) || 1;
    return { aging, agingMax: Math.max(1, ...aging.map((a) => a.total)), top: all.slice(0, 5).map((c) => ({ ...c, share: c.total / sumAll })) };
  }, [biz.id, prefs.hide]);

  return (
    <Stagger>
      {partial && (
        <div className="lg-12" style={{ display: 'flex' }}>
          <PillTabs id="basis" items={[{ value: 'all', label: '100% מהעסק' }, { value: 'mine', label: `החלק שלי (${biz.owner_pct}%)` }]} value={mine ? 'mine' : 'all'} onChange={(v) => setMine(v === 'mine')} />
        </div>
      )}
      <Card className="lg-3 md-6 sm-6"><Kpi label="הכנסות החודש" icon={TrendingUp} tone={TONE} value={hasData ? money(s.cur.income * k) : 'אין נתונים עדיין'} delta={d(s.cur.income, s.prev.income)} foot={src ? `לפני מע״מ · כולל ${src}` : 'לפני מע״מ'} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="הוצאות החודש" icon={Receipt} tone={TONE} value={hasData ? money(s.cur.expense * k) : 'אין נתונים עדיין'} delta={d(s.cur.expense, s.prev.expense)} invert foot={ops ? 'כולל הוצאות מ־Buyz' : 'לפני מע״מ'} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="רווח החודש" icon={Wallet} tone={TONE} value={hasData ? <span className={s.cur.profit < 0 ? 'neg' : ''}>{money(s.cur.profit * k)}</span> : 'אין נתונים עדיין'} delta={d(s.cur.profit, s.prev.profit)} foot={s.cur.income ? `שולי רווח ${percent(s.cur.profit / s.cur.income)}` : undefined} /></Card>
      <Card className="lg-3 md-6 sm-6" to={`/business/${biz.id}/invoices`}><Kpi label="לקוחות חייבים" icon={Banknote} tone={TONE} value={money(s.receivable)} foot={s.overdue.length ? <span className="neg">{money(s.overdueTotal)} באיחור</span> : 'כולל מע״מ · אין איחורים'} /></Card>

      <Card className="lg-8 md-12">
        <CardHead title="הכנסות מול הוצאות" sub="6 חודשים · לפני מע״מ" />
        {hasData ? <BarChart data={s.series.map((m) => ({ month: m.month, a: m.income * k, b: m.expense * k }))} aLabel="הכנסות" bLabel="הוצאות" height={230} width={820} /> : <Empty icon={TrendingUp} title="אין נתונים עדיין" text="הוסף חשבוניות והוצאות, או חבר את מערכת החשבוניות." />}
      </Card>

      <Card className="flush lg-4 md-12">
        <div className="card-head" style={{ padding: '20px 20px 0', marginBottom: 6 }}><h2>לטיפול</h2></div>
        {s.overdue.length + s.missingAlloc.length === 0 ? <Empty icon={ListChecks} title="אין חריגים" text="אין חשבוניות באיחור או בלי מספר הקצאה." /> : (
          <div className="list">
            {s.missingAlloc.map((i) => (
              <button key={'a' + i.id} className="li clickable" style={{ width: '100%', textAlign: 'start' }} onClick={() => nav(`/business/${biz.id}/invoices`)}>
                <span className="li-icon" style={{ background: 'var(--neg-bg)', color: 'var(--neg)' }}><CircleAlert size={18} /></span>
                <span className="li-main"><span className="li-title" style={{ display: 'block' }}>חסר מספר הקצאה</span><span className="li-meta">חשבונית {i.number} · {i.client}</span></span>
              </button>
            ))}
            {s.overdue.map((i) => (
              <button key={i.id} className="li clickable" style={{ width: '100%', textAlign: 'start' }} onClick={() => nav(`/business/${biz.id}/invoices`)}>
                <span className="li-icon" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}><Banknote size={18} /></span>
                <span className="li-main"><span className="li-title" style={{ display: 'block' }}>{i.client}</span><span className="li-meta">{-daysUntil(i.due_date)} ימים באיחור · חשבונית {i.number}</span></span>
                <span className="li-amount">{money(gross(i))}</span>
              </button>
            ))}
          </div>
        )}
        {s.mrr > 0 && <div style={{ padding: 20, borderTop: '1px solid var(--line)' }}><Kpi label="ריטיינרים פעילים (חודשי)" value={money(s.mrr * k)} foot="לפני מע״מ" /></div>}
      </Card>

      {revs.map((r) => <RevenueView key={r.provider} name={r.name} snap={r.snap} k={k} />)}
      {synced && <p className="meta lg-12">עודכן אוטומטית מ־{src} ב־{new Date(synced).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}. מתעדכן לבד כל כמה דקות.</p>}

      <Card className="lg-6 md-12">
        <CardHead title="גיל החוב" sub="חשבוניות פתוחות לפי ימי איחור · כולל מע״מ" />
        {x.aging.every((a) => !a.total) ? <p className="meta">אין חשבוניות פתוחות.</p> : (
          <div className="stack" style={{ gap: 14 }}>
            {x.aging.map((a) => (
              <div key={a.label}>
                <div className="spread" style={{ marginBottom: 6 }}><span className="label">{a.label}<span className="meta"> · {a.count} חשבוניות</span></span><b className="num" style={{ fontWeight: 500 }}>{money(a.total)}</b></div>
                <Meter small value={a.total} max={x.agingMax} tone={a.tone} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="flush lg-6 md-12">
        <div className="card-head" style={{ padding: '20px 20px 0', marginBottom: 6 }}><div><h2>לקוחות מובילים</h2><div className="sub">12 חודשים אחרונים · לפני מע״מ</div></div></div>
        {x.top.length === 0 ? <Empty icon={Users} title="אין נתונים עדיין" /> : (
          <div className="list">
            {x.top.map((c) => (
              <div key={c.name} className="li">
                <span className="li-icon num" style={{ fontSize: 12, fontWeight: 500 }}>{percent(c.share)}</span>
                <span className="li-main"><span className="li-title" style={{ display: 'block' }}>{c.name}</span><span className="li-meta">{c.count} חשבוניות{c.open ? ` · ${money(c.open)} פתוח` : ''}</span></span>
                <span className="li-amount">{money(c.total * k)}</span>
              </div>
            ))}
          </div>
        )}
        {x.top[0]?.share > 0.4 && <p className="meta" style={{ padding: '0 20px 16px' }}>לקוח אחד אחראי ליותר מ־40% מההכנסות. כדאי לשים לב לתלות.</p>}
      </Card>
    </Stagger>
  );
}

/* ================= Invoices ================= */
const STATE = { paid: ['pos', 'שולמה'], overdue: ['neg', 'באיחור'], open: ['info', 'ממתינה'], draft: ['none', 'טיוטה'], void: ['none', 'בוטלה'] } as const;

function Invoices({ biz }: { biz: Rec }) {
  const rows = useCollection('invoices', (r) => r.business_id === biz.id, [biz.id]);
  const crud = useCrud('invoices', { business_id: biz.id });
  const [filter, setFilter] = useState<'all' | 'open' | 'overdue' | 'paid'>('all');
  const sorted = useMemo(() => [...rows].sort((a, b) => (b.issue_date || '').localeCompare(a.issue_date || '')), [rows]);
  const count = (f: string) => sorted.filter((r) => invoiceState(r) === f).length;
  const list = sorted.filter((r) => filter === 'all' || invoiceState(r) === filter);
  const rate = vatRate();

  return (
    <Stagger>
      <Card className="flush lg-12">
        <div className="card-head wrap" style={{ padding: '20px 20px 12px', marginBottom: 0, flexWrap: 'wrap' }}>
          <div className="chips">
            {([['all', 'הכול', sorted.length], ['open', 'ממתינות', count('open')], ['overdue', 'באיחור', count('overdue')], ['paid', 'שולמו', count('paid')]] as const).map(([v, l, n]) => (
              <button key={v} className="chip" aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}<span className="count num">{n}</span></button>
            ))}
          </div>
          <AddButton small label="חשבונית" onClick={() => crud.openNew()} />
        </div>
        {list.length === 0 ? <Empty icon={FileText} title="אין חשבוניות כאן" text="אפשר להוסיף ידנית. אחרי חיבור מערכת החשבוניות הן ייכנסו לבד." /> : (
          <>
            <div className="scroll-x hide-sm">
              <table className="table">
                <thead><tr><th>מס׳</th><th>לקוח</th><th>הופקה</th><th>לתשלום עד</th><th className="num">לפני מע״מ</th><th className="num">כולל מע״מ</th><th>סטטוס</th><th /></tr></thead>
                <tbody>
                  {list.map((r) => {
                    const st = STATE[invoiceState(r)];
                    return (
                      <tr key={r.id} className="clickable" onClick={() => crud.openEdit(r)} style={{ cursor: 'pointer' }}>
                        <td className="num ltr" style={{ textAlign: 'right' }}>{r.number}</td>
                        <td style={{ fontWeight: 500 }}>{r.client}</td>
                        <td className="muted">{shortDate(r.issue_date)}</td>
                        <td className="muted">{shortDate(r.due_date)}</td>
                        <td className="num">{money(r.amount_net)}</td>
                        <td className="num" style={{ fontWeight: 500 }}>{money(gross(r))}</td>
                        <td><span className="row" style={{ gap: 6 }}><Badge kind={st[0]}>{st[1]}</Badge>{needsAllocation(r) && <Badge kind="neg">חסר מס׳ הקצאה</Badge>}</span></td>
                        <td>{invoiceState(r) !== 'paid' && invoiceState(r) !== 'void' && <button className="btn btn-soft btn-sm" onClick={(e) => { e.stopPropagation(); store.update('invoices', r.id, { status: 'שולמה' }); }}>סמן כשולמה</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="list show-sm" style={{ display: undefined }}>
              {list.map((r) => {
                const st = STATE[invoiceState(r)];
                return (
                  <div key={r.id} className="li clickable" onClick={() => crud.openEdit(r)}>
                    <div className="li-main"><div className="li-title">{r.client}</div><div className="li-meta"><span className="ltr">#{r.number}</span> · {shortDate(r.issue_date)}{needsAllocation(r) && <span className="neg"> · חסר מס׳ הקצאה</span>}</div></div>
                    <div className="li-end" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}><span className="li-amount">{money(gross(r))}</span><Badge kind={st[0]}>{st[1]}</Badge></div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div className="meta" style={{ padding: '12px 20px', borderTop: '1px solid var(--line)' }}>מע״מ מחושב לפי שיעור מתוארך מטבלת הפרמטרים ({rate ? percent(rate) : 'לא הוגדר'} היום), לא קבוע בקוד.</div>
      </Card>
      {crud.sheet}
    </Stagger>
  );
}

function Clients({ biz }: { biz: Rec }) {
  const rows = useCollection('clients', (r) => r.business_id === biz.id, [biz.id]);
  const crud = useCrud('clients', { business_id: biz.id });
  const active = rows.filter((r) => r.status === 'פעיל');
  const mrr = active.reduce((a, r) => a + (r.monthly_fee || 0), 0);
  const top = Math.max(0, ...active.map((r) => r.monthly_fee || 0));
  return (
    <Stagger>
      <Card className="lg-4 md-12" style={{ alignSelf: 'start' }}>
        <Kpi label="הכנסה חודשית קבועה" icon={Users} tone={TONE} value={rows.length ? money(mrr) : 'אין נתונים עדיין'} foot={`${active.length} לקוחות פעילים · לפני מע״מ`} />
        {mrr > 0 && <p className="meta" style={{ marginTop: 10 }}>הלקוח הגדול ביותר הוא {percent(top / mrr)} מההכנסה הקבועה.</p>}
        <div className="divider" /><AddButton label="לקוח חדש" onClick={() => crud.openNew()} />
      </Card>
      <Card className="flush lg-8 md-12">
        <RecordList collection="clients" rows={[...rows].sort((a, b) => (b.monthly_fee || 0) - (a.monthly_fee || 0))} scope={{ business_id: biz.id }} icon={Users} emptyTitle="אין לקוחות עדיין"
          title={(r) => r.name} meta={(r) => <>{[r.contact, r.phone].filter(Boolean).join(' · ') || 'אין איש קשר'}</>}
          end={(r) => <>{r.monthly_fee ? <span className="li-amount">{money(r.monthly_fee)}</span> : null}<Badge kind={r.status === 'פעיל' ? 'pos' : r.status === 'ליד' ? 'info' : 'none'}>{r.status}</Badge></>} />
      </Card>
      {crud.sheet}
    </Stagger>
  );
}

function Expenses({ biz }: { biz: Rec }) {
  const rows = useCollection('biz_expenses', (r) => r.business_id === biz.id, [biz.id]);
  const crud = useCrud('biz_expenses', { business_id: biz.id });
  const sorted = [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return (
    <Stagger>
      <Card className="flush lg-12">
        <div className="card-head" style={{ padding: '20px 20px 8px', marginBottom: 0 }}><div><h2>הוצאות וספקים</h2><div className="sub">{rows.length} רשומות · סכומים לפני מע״מ</div></div><AddButton small label="הוצאה" onClick={() => crud.openNew()} /></div>
        <RecordList collection="biz_expenses" rows={sorted.slice(0, 60)} scope={{ business_id: biz.id }} icon={Receipt} emptyTitle="אין הוצאות עדיין"
          title={(r) => r.title} meta={(r) => <>{[r.category, r.supplier, shortDate(r.date)].filter(Boolean).join(' · ')}</>} end={(r) => <span className="li-amount">{money(r.amount_net)}</span>} />
      </Card>
      {crud.sheet}
    </Stagger>
  );
}

function BizTasks({ biz }: { biz: Rec }) {
  const rows = useCollection('biz_tasks', (r) => r.business_id === biz.id, [biz.id]);
  return <Stagger><Card className="flush lg-12"><TaskList collection="biz_tasks" rows={rows} scope={{ business_id: biz.id }} /></Card></Stagger>;
}

