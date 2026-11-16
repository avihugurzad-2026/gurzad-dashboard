import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Banknote, Briefcase, CircleAlert, FileText, LayoutGrid, Link2, ListChecks, Pencil, Plus, Receipt, TrendingUp, Users, Wallet } from 'lucide-react';
import type { Rec } from '../../data/types';
import { useCollection, useDerived, store } from '../../data/store';
import { bizSummary, gross, invoiceState, needsAllocation, vatRate } from '../../data/derive';
import { daysUntil, money, percent, shortDate } from '../../lib/format';
import { usePrefs } from '../../lib/prefs';
import { AddButton, useCrud } from '../../ui/crud';
import { BarChart } from '../../ui/charts';
import { Badge, Card, CardHead, Empty, Kpi, PageHead, PillTabs, Stagger, TabBody, spring } from '../../ui/kit';
import { RecordList, TaskList } from '../../ui/lists';

const TONE = 'var(--tone-business)';
const TABS = [
  { value: 'overview', label: 'מצב כספי', icon: LayoutGrid },
  { value: 'invoices', label: 'חשבוניות', icon: FileText },
  { value: 'clients', label: 'לקוחות', icon: Users },
  { value: 'expenses', label: 'הוצאות', icon: Receipt },
  { value: 'tasks', label: 'משימות', icon: ListChecks },
  { value: 'connections', label: 'חיבורים', icon: Link2 },
] as const;
type Tab = (typeof TABS)[number]['value'];

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

  const View = { overview: BizOverview, invoices: Invoices, clients: Clients, expenses: Expenses, tasks: BizTasks, connections: Connections }[tab as Tab] ?? BizOverview;

  return (
    <>
      <PageHead tag="ניהול עסקים" tone={TONE} title={biz.name} sub={<>{biz.kind}{biz.owner_pct != null && biz.owner_pct < 100 ? ` · החלק שלי ${biz.owner_pct}%` : ''}</>}>
        <button className="btn btn-ghost" onClick={() => bizCrud.openEdit(biz)}><Pencil size={15} />פרטי העסק</button>
      </PageHead>

      {/* business switcher */}
      <div className="chips" style={{ marginBottom: 14 }} role="tablist" aria-label="בחירת עסק">
        {businesses.map((b) => {
          const on = b.id === biz.id;
          return (
            <button key={b.id} role="tab" aria-selected={on} className="chip" aria-pressed={on} style={{ position: 'relative', background: on ? 'transparent' : undefined, borderColor: on ? 'transparent' : undefined }} onClick={() => nav(`/business/${b.id}${tab !== 'overview' ? '/' + tab : ''}`)}>
              {on && <motion.span layoutId="biz-chip" transition={spring} style={{ position: 'absolute', inset: -1, borderRadius: 999, background: 'var(--accent)' }} />}
              <span style={{ position: 'relative' }}>{b.name}</span>
            </button>
          );
        })}
        <button className="chip" onClick={() => bizCrud.openNew()} style={{ borderStyle: 'dashed' }}><Plus size={14} />עסק חדש</button>
      </div>

      <div className="subnav"><PillTabs id="biz" items={[...TABS]} value={tab as Tab} onChange={(v) => nav(`/business/${biz.id}${v === 'overview' ? '' : '/' + v}`)} /></div>
      <TabBody id={biz.id + tab}><View biz={biz} /></TabBody>
      {bizCrud.sheet}
    </>
  );
}

/* ================= Overview ================= */
function BizOverview({ biz }: { biz: Rec }) {
  const prefs = usePrefs();
  const nav = useNavigate();
  const [mine, setMine] = useState(false);
  const s = useDerived(() => bizSummary(biz.id), [biz.id, prefs.hide]);
  const k = mine ? (biz.owner_pct ?? 100) / 100 : 1;
  const partial = (biz.owner_pct ?? 100) < 100;
  const d = (a: number, b: number) => (b ? (a - b) / Math.abs(b) : null);
  const hasData = s.series.some((m) => m.income || m.expense);

  return (
    <Stagger>
      {partial && (
        <div className="lg-12" style={{ display: 'flex' }}>
          <PillTabs id="basis" items={[{ value: 'all', label: '100% מהעסק' }, { value: 'mine', label: `החלק שלי (${biz.owner_pct}%)` }]} value={mine ? 'mine' : 'all'} onChange={(v) => setMine(v === 'mine')} />
        </div>
      )}
      <Card className="lg-3 md-6 sm-6"><Kpi label="הכנסות החודש" icon={TrendingUp} tone={TONE} value={hasData ? money(s.cur.income * k) : 'אין נתונים עדיין'} delta={d(s.cur.income, s.prev.income)} foot="לפני מע״מ" /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="הוצאות החודש" icon={Receipt} tone={TONE} value={hasData ? money(s.cur.expense * k) : 'אין נתונים עדיין'} delta={d(s.cur.expense, s.prev.expense)} invert foot="לפני מע״מ" /></Card>
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

function Connections({ biz }: { biz: Rec }) {
  const rows = useCollection('integrations', (r) => r.business_id === biz.id, [biz.id]);
  const crud = useCrud('integrations', { business_id: biz.id });
  return (
    <Stagger>
      <Card className="flush lg-8 md-12">
        <div className="card-head" style={{ padding: '20px 20px 8px', marginBottom: 0 }}><div><h2>מקורות נתונים של {biz.name}</h2><div className="sub">מערכות חיצוניות שיזינו את העסק אוטומטית</div></div><AddButton small label="חיבור" onClick={() => crud.openNew()} /></div>
        <RecordList collection="integrations" rows={rows} scope={{ business_id: biz.id }} icon={Link2} emptyTitle="אין חיבורים עדיין"
          title={(r) => r.name} meta={(r) => <>{r.kind}{r.note ? ` · ${r.note}` : ''}</>}
          end={(r) => <Badge kind={r.status === 'מחובר' ? 'pos' : r.status === 'שגיאה' ? 'neg' : 'none'}>{r.status}</Badge>} />
      </Card>
      <Card className="soft lg-4 md-12" style={{ alignSelf: 'start' }}>
        <CardHead title="איך זה יעבוד" />
        <ol className="steps">
          <li>בוחרים ספק (למשל מערכת החשבוניות של העסק) ומוסיפים מפתח API במסך ההגדרות.</li>
          <li>סנכרון מושך חשבוניות והוצאות לתוך אותם מסכים שכבר קיימים כאן.</li>
          <li>רשומות שהגיעו מסנכרון מסומנות, והזנה ידנית ממשיכה לעבוד לצדן.</li>
        </ol>
        <p className="meta" style={{ marginTop: 14 }}>עדיין לא מחובר לאף ספק. נקודת הכניסה מוכנה: <span className="ltr">api/sync-invoices.ts</span>.</p>
      </Card>
      {crud.sheet}
    </Stagger>
  );
}
