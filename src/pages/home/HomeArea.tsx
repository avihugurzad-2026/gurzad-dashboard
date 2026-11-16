import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownLeft, ArrowUpRight, CalendarClock, ChevronLeft, FileText, ListChecks, PiggyBank, Receipt, ShoppingBasket, Wallet, Wrench, LayoutGrid, Check } from 'lucide-react';
import { useCollection, useDerived, store } from '../../data/store';
import { homeMonth, homeTrend } from '../../data/derive';
import { SHOP_DEPTS } from '../../data/schemas';
import { daysUntil, money, monthLong, relDay, shortDate, thisMonth, today } from '../../lib/format';
import { usePrefs } from '../../lib/prefs';
import { AddButton, useCrud } from '../../ui/crud';
import { BarChart } from '../../ui/charts';
import { Badge, Card, CardHead, CheckBox, DotNum, Empty, Kpi, Meter, PageHead, PillTabs, Stagger, TabBody, easeOut } from '../../ui/kit';
import { QuickAdd, RecordList, TaskList } from '../../ui/lists';
import { useToast } from '../../ui/overlay';

const TABS = [
  { value: 'overview', label: 'סקירה', icon: LayoutGrid },
  { value: 'tasks', label: 'משימות', icon: ListChecks },
  { value: 'shopping', label: 'קניות', icon: ShoppingBasket },
  { value: 'budget', label: 'תקציב והוצאות', icon: Wallet },
  { value: 'bills', label: 'חשבונות', icon: CalendarClock },
  { value: 'maintenance', label: 'תחזוקה', icon: Wrench },
  { value: 'documents', label: 'מסמכים', icon: FileText },
] as const;
type Tab = (typeof TABS)[number]['value'];
const TONE = 'var(--tone-home)';

export function HomeArea() {
  const { tab = 'overview' } = useParams();
  const nav = useNavigate();
  const tasks = useCollection('home_tasks');
  const shopping = useCollection('shopping');
  const openTasks = tasks.filter((t) => !t.done).length;
  const openShop = shopping.filter((s) => !s.done).length;
  const items = TABS.map((t) => ({ ...t, count: t.value === 'tasks' ? openTasks : t.value === 'shopping' ? openShop : undefined }));
  const View = { overview: HomeOverview, tasks: HomeTasks, shopping: Shopping, budget: Budget, bills: Bills, maintenance: Maintenance, documents: Documents }[tab as Tab] ?? HomeOverview;

  return (
    <>
      <PageHead tag="ניהול הבית" tone={TONE} title="הבית" sub={monthLong(thisMonth())} />
      <div className="subnav"><PillTabs id="home" items={items} value={tab as Tab} onChange={(v) => nav(v === 'overview' ? '/home' : `/home/${v}`)} /></div>
      <TabBody id={tab}><View /></TabBody>
    </>
  );
}

/* ================= Overview ================= */
function HomeOverview() {
  const prefs = usePrefs();
  const tasks = useCollection('home_tasks');
  const shopping = useCollection('shopping');
  const bills = useCollection('bills');
  const d = useDerived(() => ({ m: homeMonth(), trend: homeTrend() }), [prefs.hide]);
  const left = d.m.budget - d.m.spent;
  const daily = Array.from({ length: 30 }, (_, i) => d.m.tx.filter((t) => t.kind === 'הוצאה' && Number(t.date.slice(8, 10)) === i + 1 && t.amount < 3000).reduce((a, t) => a + t.amount, 0));
  const dailyMax = Math.max(1, ...daily);
  const todayTasks = tasks.filter((t) => !t.done && t.due && daysUntil(t.due) <= 0);
  const nextBills = [...bills].filter((b) => b.next_due).sort((a, b) => a.next_due.localeCompare(b.next_due)).slice(0, 4);
  const openShop = shopping.filter((s) => !s.done);

  return (
    <Stagger>
      <Card className="hero lg-5 md-12">
        <div className="spread"><span className="hero-label"><PiggyBank size={16} />נשאר בתקציב החודש</span><span className="hero-chip">{d.m.budget ? `${Math.round((d.m.spent / d.m.budget) * 100)}% נוצל` : 'ללא תקציב'}</span></div>
        <div className="hero-num"><DotNum value={prefs.hide ? '•••' : money(Math.abs(left)).replace(/\s/g, '')} label={money(left)} /></div>
        <div className="hero-sub">{left < 0 ? 'חריגה מהתקציב · ' : ''}יצאו {money(d.m.spent)} מתוך {money(d.m.budget)}</div>
        <div className="hero-ticks" role="img" aria-label="הוצאות לפי יום בחודש">
          {daily.map((v, i) => <i key={i} className={i < new Date().getDate() ? 'on' : ''} style={{ height: `${12 + (v / dailyMax) * 88}%` }} />)}
        </div>
      </Card>

      <Card className="lg-7 md-12">
        <CardHead title="הכנסות מול הוצאות" sub="6 חודשים אחרונים"><Link className="card-link" to="/home/budget">לתקציב<ChevronLeft size={14} /></Link></CardHead>
        <BarChart data={d.trend.map((t) => ({ month: t.month, a: t.income, b: t.spent }))} aLabel="הכנסות" bLabel="הוצאות" />
      </Card>

      <Card className="lg-4 md-6">
        <CardHead title="איפה הכסף הולך" sub="לפי ניצול התקציב" />
        <div className="stack" style={{ gap: 14 }}>
          {d.m.byCat.slice(0, 5).map((c) => (
            <div key={c.category}>
              <div className="spread" style={{ fontSize: 13, marginBottom: 6 }}><span>{c.category}</span><span className={`num ${c.spent > c.budget ? 'neg' : 'muted'}`}>{money(c.spent)} / {money(c.budget)}</span></div>
              <Meter small value={c.spent} max={c.budget} tone={TONE} />
            </div>
          ))}
          {d.m.byCat.length === 0 && <p className="muted">עוד לא הוגדר תקציב.</p>}
        </div>
      </Card>

      <Card className="flush lg-4 md-6">
        <div className="card-head" style={{ padding: '20px 20px 0', marginBottom: 6 }}><h2>להיום</h2><Link className="card-link" to="/home/tasks">כל המשימות<ChevronLeft size={14} /></Link></div>
        {todayTasks.length === 0 ? <Empty icon={Check} title="אין משימות להיום" /> : (
          <div className="list">{todayTasks.slice(0, 4).map((t) => (
            <div key={t.id} className="li"><CheckBox checked={false} onChange={() => store.update('home_tasks', t.id, { done: true })} label={t.title} />
              <div className="li-main"><div className="li-title">{t.title}</div><div className="li-meta"><span className={daysUntil(t.due) < 0 ? 'neg' : ''}>{relDay(t.due)}</span></div></div></div>
          ))}</div>
        )}
      </Card>

      <Card className="flush lg-4 md-12">
        <div className="card-head" style={{ padding: '20px 20px 0', marginBottom: 6 }}><h2>חשבונות קרובים</h2><Link className="card-link" to="/home/bills">הכול<ChevronLeft size={14} /></Link></div>
        <div className="list">{nextBills.map((b) => (
          <div key={b.id} className="li"><span className="li-icon"><CalendarClock size={18} /></span>
            <div className="li-main"><div className="li-title">{b.name}</div><div className="li-meta"><span className={daysUntil(b.next_due) < 0 ? 'neg' : ''}>{relDay(b.next_due)}</span> · {b.method}</div></div>
            <span className="li-amount">{money(b.amount)}</span></div>
        ))}</div>
      </Card>

      <Card className="lg-12" to="/home/shopping">
        <div className="spread">
          <div className="row"><span className="li-icon"><ShoppingBasket size={18} /></span><div><b style={{ fontWeight: 500 }}>רשימת קניות</b><div className="meta">{openShop.length ? `${openShop.length} פריטים מחכים: ${openShop.slice(0, 5).map((s) => s.name).join(', ')}${openShop.length > 5 ? '…' : ''}` : 'הרשימה ריקה'}</div></div></div>
          <ChevronLeft size={18} className="muted" />
        </div>
      </Card>
    </Stagger>
  );
}

/* ================= Tasks ================= */
function HomeTasks() {
  const rows = useCollection('home_tasks');
  return <Stagger><Card className="flush lg-12"><TaskList collection="home_tasks" rows={rows} /></Card></Stagger>;
}

/* ================= Shopping ================= */
function guessDept(name: string) {
  const map: [RegExp, string][] = [
    [/חלב|גבינ|יוגורט|ביצ|חמאה|שמנת|קוטג/, 'חלב וביצים'], [/עגבני|מלפפו|בצל|תפו|בננ|גזר|חסה|לימון|פלפל|אבוקדו|פירות|ירק/, 'ירקות ופירות'],
    [/לחם|פית|חלה|לחמני|עוג/, 'מאפייה'], [/עוף|בשר|דג|סלמון|נקניק|שניצל/, 'בשר ודגים'], [/אורז|פסטה|קמח|סוכר|שימור|טונה|קפה|תה|שמן|קטשופ|דגני/, 'יבשים ושימורים'],
    [/קפוא|גלידה/, 'קפואים'], [/ניקוי|נוזל|אקונומיקה|נייר|מגבונ|שקיות|כביסה/, 'ניקיון'], [/שמפו|סבון|משחת|דאודורנט|תחבוש|חיתול/, 'פארם'],
  ];
  return map.find(([re]) => re.test(name))?.[1] ?? 'אחר';
}

function Shopping() {
  const rows = useCollection('shopping');
  const crud = useCrud('shopping');
  const toast = useToast();
  const groups = useMemo(() => SHOP_DEPTS.map((dept) => ({ dept, items: rows.filter((r) => (r.dept || 'אחר') === dept).sort((a, b) => Number(a.done) - Number(b.done)) })).filter((g) => g.items.length), [rows]);
  const done = rows.filter((r) => r.done).length;

  const add = (text: string) => {
    // "חלב, ביצים x12, לחם" → 3 items
    text.split(/[,،\n]/).map((s) => s.trim()).filter(Boolean).forEach((raw) => {
      const m = raw.match(/^(.*?)(?:\s*[xX×*]\s*(\d+)|\s+(\d+))?$/);
      const name = (m?.[1] || raw).trim();
      store.add('shopping', { name, qty: m?.[2] || m?.[3] || '', dept: guessDept(name), done: false });
    });
  };

  return (
    <Stagger>
      <Card className="flush lg-8 md-12">
        <QuickAdd placeholder="מה חסר? אפשר כמה פריטים עם פסיק" onAdd={add} />
        {rows.length === 0 ? <Empty icon={ShoppingBasket} title="הרשימה ריקה" text="כתוב פריט בשורה למעלה, או שלח לסוכן בוואטסאפ: ״תוסיף חלב״." /> : groups.map((g) => (
          <div key={g.dept}>
            <div className="meta" style={{ padding: '14px 20px 4px', fontWeight: 500 }}>{g.dept}</div>
            <div className="list no-top">
              <AnimatePresence initial={false}>
                {g.items.map((it) => (
                  <motion.div key={it.id} layout="position" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto', transition: { duration: 0.2, ease: easeOut } }} exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }} style={{ overflow: 'hidden' }}>
                    {/* whole row toggles — the most frequent action in the app, so no animation delay */}
                    <div className="li clickable" onClick={() => store.update('shopping', it.id, { done: !it.done })}>
                      <CheckBox checked={!!it.done} onChange={(v) => store.update('shopping', it.id, { done: v })} label={it.name} />
                      <div className="li-main"><div className={`li-title ${it.done ? 'done' : ''}`}>{it.name}</div></div>
                      <div className="li-end">{it.qty && <span className="badge num">{it.qty}</span>}
                        <button className="icon-btn bare" aria-label={`עריכת ${it.name}`} onClick={(e) => { e.stopPropagation(); crud.openEdit(it); }}><ChevronLeft size={16} /></button></div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        ))}
      </Card>
      <Card className="lg-4 md-12" style={{ alignSelf: 'start' }}>
        <Kpi label="בעגלה" icon={ShoppingBasket} tone={TONE} value={<><span className="num">{done}</span> <span className="muted" style={{ fontSize: 16 }}>מתוך {rows.length}</span></>} />
        <div style={{ marginBlock: 14 }}><Meter value={done} max={rows.length || 1} tone={TONE} /></div>
        <button className="btn btn-soft btn-block" disabled={!done} onClick={() => { const undo = store.removeWhere('shopping', (r) => !!r.done); toast(`${done} פריטים נוקו מהרשימה`, undo); }}><Check size={16} />סיימנו לקנות · ניקוי המסומנים</button>
        <p className="meta" style={{ marginTop: 12 }}>טיפ: בוואטסאפ אפשר לכתוב ״תוסיף לקניות…״ והפריטים יופיעו כאן.</p>
      </Card>
      {crud.sheet}
    </Stagger>
  );
}

/* ================= Budget ================= */
function Budget() {
  const prefs = usePrefs();
  const d = useDerived(() => homeMonth(), [prefs.hide]);
  const tx = useCollection('transactions');
  const budgets = useCollection('budgets');
  const txCrud = useCrud('transactions');
  const budCrud = useCrud('budgets');
  const month = thisMonth();
  const list = useMemo(() => tx.filter((t) => (t.date || '').startsWith(month)).sort((a, b) => b.date.localeCompare(a.date)), [tx, month]);

  return (
    <Stagger>
      <Card className="lg-4 md-6 sm-6"><Kpi label="הכנסות החודש" icon={ArrowDownLeft} tone={TONE} value={money(d.income)} /></Card>
      <Card className="lg-4 md-6 sm-6"><Kpi label="הוצאות החודש" icon={ArrowUpRight} tone={TONE} value={money(d.spent)} foot={d.budget ? `תקציב ${money(d.budget)}` : undefined} /></Card>
      <Card className="lg-4 md-12"><Kpi label="נשאר" icon={PiggyBank} tone={TONE} value={<span className={d.income - d.spent < 0 ? 'neg' : ''}>{money(d.income - d.spent)}</span>} foot="הכנסות פחות הוצאות" /></Card>

      <Card className="lg-5 md-12" style={{ alignSelf: 'start' }}>
        <CardHead title="תקציב לפי קטגוריה"><AddButton small label="סעיף" onClick={() => budCrud.openNew()} /></CardHead>
        {d.byCat.length === 0 ? <Empty icon={Wallet} title="אין תקציב עדיין" text="הוסף סעיף ראשון כדי לראות כמה נשאר בכל קטגוריה." /> : (
          <div className="stack" style={{ gap: 16 }}>
            {d.byCat.map((c) => {
              const b = budgets.find((x) => x.category === c.category);
              return (
                <button key={c.category} style={{ textAlign: 'start' }} onClick={() => b && budCrud.openEdit(b)}>
                  <div className="spread" style={{ fontSize: 14, marginBottom: 6 }}>
                    <span style={{ fontWeight: 500 }}>{c.category}</span>
                    <span className="num meta">{c.spent > c.budget ? <span className="neg">חריגה {money(c.spent - c.budget)}</span> : <>נשאר {money(c.budget - c.spent)}</>}</span>
                  </div>
                  <Meter small value={c.spent} max={c.budget} tone={TONE} />
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="flush lg-7 md-12">
        <div className="card-head" style={{ padding: '20px 20px 12px', marginBottom: 0 }}>
          <div><h2>תנועות החודש</h2><div className="sub">{list.length} תנועות</div></div>
          <div className="row"><button className="btn btn-soft btn-sm" onClick={() => txCrud.openNew({ kind: 'הכנסה', category: 'משכורת' })}>הכנסה</button><AddButton small label="הוצאה" onClick={() => txCrud.openNew({ kind: 'הוצאה', date: today() })} /></div>
        </div>
        {list.length === 0 ? <Empty icon={Receipt} title="אין תנועות החודש" text="הוסף הוצאה ראשונה, או צלם קבלה ושלח לסוכן בוואטסאפ (אחרי חיבור Gemini)." /> : (
          <div className="list">
            {list.map((t) => (
              <div key={t.id} className="li clickable" onClick={() => txCrud.openEdit(t)}>
                <span className="li-icon" style={t.kind === 'הכנסה' ? { background: 'var(--pos-bg)', color: 'var(--pos)' } : undefined}>{t.kind === 'הכנסה' ? <ArrowDownLeft size={18} /> : <Receipt size={18} />}</span>
                <div className="li-main"><div className="li-title">{t.title}</div><div className="li-meta">{t.category} · {shortDate(t.date)}{t.source === 'whatsapp' ? ' · דרך וואטסאפ' : ''}</div></div>
                <span className={`li-amount ${t.kind === 'הכנסה' ? 'pos' : ''}`}>{t.kind === 'הכנסה' ? '+' : '−'}{money(t.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      {txCrud.sheet}{budCrud.sheet}
    </Stagger>
  );
}

/* ================= Bills / maintenance / documents ================= */
function dueBadge(date?: string, soon = 7) {
  if (!date) return null;
  const n = daysUntil(date);
  if (n < 0) return <Badge kind="neg">עבר · {shortDate(date)}</Badge>;
  if (n <= soon) return <Badge kind="warn">{relDay(date)}</Badge>;
  return <Badge>{shortDate(date)}</Badge>;
}

function Bills() {
  const rows = useCollection('bills');
  const crud = useCrud('bills');
  const sorted = [...rows].sort((a, b) => (a.next_due || '9').localeCompare(b.next_due || '9'));
  const perMonth = rows.reduce((a, b) => a + (b.amount || 0) / ({ 'חודשי': 1, 'דו־חודשי': 2, 'רבעוני': 3, 'שנתי': 12 }[b.frequency as string] ?? 1), 0);
  return (
    <Stagger>
      <Card className="lg-4 md-12" style={{ alignSelf: 'start' }}>
        <Kpi label="קבועים בחודש (ממוצע)" icon={CalendarClock} tone={TONE} value={money(Math.round(perMonth))} foot={`${rows.length} חשבונות ומנויים`} />
        <div className="divider" />
        <AddButton label="חשבון חדש" onClick={() => crud.openNew()} />
      </Card>
      <Card className="flush lg-8 md-12">
        <RecordList collection="bills" rows={sorted} icon={CalendarClock} emptyTitle="אין חשבונות עדיין" emptyText="חשמל, ארנונה, מים, מנויים — כל מה שחוזר."
          title={(r) => r.name} meta={(r) => <>{r.frequency} · {r.method}{r.provider ? ` · ${r.provider}` : ''}</>}
          end={(r) => <><span className="li-amount hide-sm">{money(r.amount)}</span>{dueBadge(r.next_due, 5)}</>} />
      </Card>
      {crud.sheet}
    </Stagger>
  );
}

function Maintenance() {
  const rows = useCollection('maintenance');
  const crud = useCrud('maintenance');
  return (
    <Stagger>
      <Card className="flush lg-12">
        <div className="card-head" style={{ padding: '20px 20px 8px', marginBottom: 0 }}><div><h2>מכשירים, אחריות וטיפולים</h2><div className="sub">מתי נגמרת האחריות ומתי הטיפול הבא</div></div><AddButton small label="פריט" onClick={() => crud.openNew()} /></div>
        <RecordList collection="maintenance" rows={rows} icon={Wrench} emptyTitle="אין פריטים עדיין" emptyText="מזגנים, דוד, רכב, מכשירי חשמל."
          title={(r) => r.item} meta={(r) => <>{[r.location, r.vendor, r.note].filter(Boolean).join(' · ')}</>}
          end={(r) => <>{r.next_service && <span className="row hide-sm" style={{ gap: 6 }}><span className="meta">טיפול</span>{dueBadge(r.next_service, 14)}</span>}{r.warranty_until && (daysUntil(r.warranty_until) < 0 ? <Badge>אחריות הסתיימה</Badge> : <Badge kind={daysUntil(r.warranty_until) < 45 ? 'warn' : 'pos'}>אחריות עד {shortDate(r.warranty_until)}</Badge>)}</>} />
      </Card>
      {crud.sheet}
    </Stagger>
  );
}

function Documents() {
  const rows = useCollection('documents');
  const crud = useCrud('documents');
  const sorted = [...rows].sort((a, b) => (a.expires || '9').localeCompare(b.expires || '9'));
  return (
    <Stagger>
      <Card className="flush lg-12">
        <div className="card-head" style={{ padding: '20px 20px 8px', marginBottom: 0 }}><div><h2>מסמכים חשובים</h2><div className="sub">ביטוחים, חוזים, רישיונות — עם תאריך תפוגה</div></div><AddButton small label="מסמך" onClick={() => crud.openNew()} /></div>
        <RecordList collection="documents" rows={sorted} icon={FileText} emptyTitle="אין מסמכים עדיין"
          title={(r) => r.title} meta={(r) => <>{r.type}{r.link ? ' · יש קובץ מצורף' : ''}</>} end={(r) => dueBadge(r.expires, 30)} />
      </Card>
      {crud.sheet}
    </Stagger>
  );
}
