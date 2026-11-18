import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Clock, ExternalLink, Link2, Mail, MapPin, Plus, RefreshCw, Unlink, User } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { store, useCollection, useDerived } from '../data/store';
import type { Rec } from '../data/types';
import { DEMO } from '../lib/config';
import { addDays, daysUntil, longDate, monthLong, relDay, shortDate, today } from '../lib/format';
import { useGoogle, type GoogleEvent } from '../lib/google';
import { saveReminderSettings, useReminderSettings } from '../lib/reminders';
import { api } from '../lib/api';
import { CATEGORY_NAMES, GOOGLE_CATEGORY, PLAN_COLLECTIONS, TEMPLATE_VARS, catVar, categoryOf, dateOf, fillTemplate, type PlanCollection, type ReminderSettings, type TemplateVars } from '../../shared/planner';
import { useCrud } from '../ui/crud';
import { Badge, Card, CardHead, CheckBox, Empty, PageHead, PillTabs, Toggle, easeOut } from '../ui/kit';
import { toggleTask } from '../ui/lists';
import { Sheet, useToast } from '../ui/overlay';

type View = 'day' | 'week' | 'month';
const VIEWS = [
  { value: 'day' as const, label: 'יום' },
  { value: 'week' as const, label: 'שבוע' },
  { value: 'month' as const, label: 'חודש' },
];
const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const DOW_LONG = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const KIND: Record<PlanCollection, string> = { home_tasks: 'משימת בית', biz_tasks: 'משימת עסק', prop_tasks: 'משימת נכס', events: 'אירוע' };

type Item = {
  key: string; col: PlanCollection | 'google'; rec?: Rec; g?: GoogleEvent;
  title: string; date: string; time?: string; end?: string; cat: string; done: boolean; late: boolean; meta: string[];
};

const dow = (iso: string) => new Date(iso + 'T12:00:00').getDay();
const weekStart = (iso: string) => addDays(iso, -dow(iso));
const sortItems = (a: Item, b: Item) => Number(a.done) - Number(b.done) || (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title, 'he');
const catStyle = (cat: string) => ({ '--cat': catVar(cat) } as CSSProperties);

export function Planner() {
  const { view: rawView } = useParams();
  const view: View = rawView === 'day' || rawView === 'month' ? rawView : 'week';
  const nav = useNavigate();
  const toast = useToast();
  const [sp] = useSearchParams();
  const [anchor, setAnchor] = useState(() => (/^\d{4}-\d{2}-\d{2}$/.test(sp.get('d') ?? '') ? sp.get('d')! : today()));
  const [hidden, setHidden] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [bizId, setBizId] = useState('');
  const businesses = useCollection('businesses');
  const properties = useCollection('properties');

  // visible range
  const range = useMemo(() => {
    if (view === 'month') {
      const first = anchor.slice(0, 8) + '01';
      const start = weekStart(first);
      return { start, end: addDays(start, 41), first };
    }
    const start = weekStart(anchor);
    return { start, end: addDays(start, 6), first: start };
  }, [view, anchor]);

  const google = useGoogle(range.start, range.end);

  const crud = {
    home_tasks: useCrud('home_tasks'),
    biz_tasks: useCrud('biz_tasks', { business_id: bizId || businesses[0]?.id }),
    prop_tasks: useCrud('prop_tasks', { property_id: properties[0]?.id }),
    events: useCrud('events'),
  };

  const items = usePlanItems();

  const all = useMemo(() => [
    ...items,
    ...google.events.map((g): Item => ({ key: 'g' + g.id, col: 'google', g, title: g.title, date: g.date, time: g.allDay ? undefined : g.time, end: g.end_time, cat: GOOGLE_CATEGORY, done: false, late: false, meta: g.place ? [g.place] : [] })),
  ], [items, google.events]);
  const visible = all.filter((i) => !hidden.includes(i.cat));
  const inRange = visible.filter((i) => i.date >= range.start && i.date <= range.end);
  const byDay = (d: string) => visible.filter((i) => i.date === d).sort(sortItems);

  // counts per category for the range (before filtering, so a hidden chip still shows its number)
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    all.filter((i) => i.date >= range.start && i.date <= range.end && !i.done).forEach((i) => m.set(i.cat, (m.get(i.cat) ?? 0) + 1));
    return m;
  }, [all, range]);
  const catList = [...CATEGORY_NAMES, ...(google.events.length ? [GOOGLE_CATEGORY] : [])];
  const totalOpen = [...counts.values()].reduce((a, b) => a + b, 0);

  const step = (n: number) => {
    if (view === 'day') setAnchor((a) => addDays(a, n));
    else if (view === 'week') setAnchor((a) => addDays(a, 7 * n));
    else setAnchor((a) => { const d = new Date(a.slice(0, 8) + '15T12:00:00'); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 8) + '01'; });
  };
  const title = view === 'day' ? longDate(anchor) : view === 'week' ? `${shortDate(range.start)} – ${shortDate(range.end)}` : monthLong(anchor.slice(0, 7));

  const open = (i: Item) => {
    if (i.col === 'google') { if (i.g?.link) window.open(i.g.link, '_blank', 'noopener'); return; }
    if (i.col === 'biz_tasks') setBizId(i.rec!.business_id);
    crud[i.col].openEdit(i.rec!);
  };
  const toggle = (i: Item, v: boolean) => { if (i.rec && i.col !== 'google' && i.col !== 'events') toggleTask(i.col, i.rec, v, toast); };
  const move = (key: string, date: string) => {
    const i = items.find((x) => x.key === key);
    if (!i || !i.rec || i.date === date || i.col === 'google') return;
    const field = i.col === 'events' ? 'date' : 'due';
    const prev = i.rec[field];
    store.update(i.col, i.rec.id, { [field]: date });
    toast(`הועבר ל${relDay(date) || shortDate(date)}`, () => store.update(i.col as PlanCollection, i.rec!.id, { [field]: prev }));
  };
  const addNew = (kind: string, date: string) => {
    setAdding(null);
    const [col, id] = kind.split(':') as [PlanCollection, string?];
    if (col === 'biz_tasks' && id) setBizId(id);
    const preset = col === 'events' ? { date } : { due: date };
    setTimeout(() => crud[col].openNew(preset), 200);
  };

  return (
    <>
      <PageHead tag="יומן ומשימות" tone="var(--slate)" title="היומן"
        sub={totalOpen ? `${totalOpen} פריטים פתוחים ב${view === 'month' ? 'חודש' : view === 'week' ? 'שבוע' : 'שבוע'} הזה` : 'אין נתונים עדיין לתקופה הזו'}>
        <button className="btn btn-primary" onClick={() => setAdding(view === 'day' ? anchor : today())}><Plus size={16} />חדש</button>
      </PageHead>

      <div className="pl-toolbar">
        <PillTabs id="pl-view" items={VIEWS} value={view} onChange={(v) => nav(`/planner/${v}`, { replace: true })} />
        <span className="grow" />
        <button className="btn btn-ghost btn-sm" onClick={() => setAnchor(today())} disabled={anchor === today()}>היום</button>
      </div>
      <div className="pl-nav">
        <button className="icon-btn" onClick={() => step(-1)} aria-label="הקודם"><ChevronRight size={18} /></button>
        <span className="pl-title">{title}</span>
        <button className="icon-btn" onClick={() => step(1)} aria-label="הבא"><ChevronLeft size={18} /></button>
        <span className="grow" />
        {view !== 'day' && totalOpen > 0 && (
          <div className="catbar hide-sm" style={{ width: 220 }} role="img" aria-label="חלוקה לפי סיווג">
            {catList.filter((c) => counts.get(c)).map((c) => <i key={c} style={{ ...catStyle(c), flex: counts.get(c) }} />)}
          </div>
        )}
      </div>

      <div className="subnav" style={{ marginBottom: 16 }}>
        <div className="chips" style={{ flexWrap: 'nowrap' }}>
          {catList.map((c) => (
            <button key={c} className="chip cat" style={catStyle(c)} aria-pressed={!hidden.includes(c)}
              onClick={() => setHidden((h) => (h.includes(c) ? h.filter((x) => x !== c) : [...h, c]))}>
              <span className="cat-dot" />{c}{counts.get(c) ? <span className="count">{counts.get(c)}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view + range.start} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.22, ease: easeOut }}>
          {view === 'day' && <DayView anchor={anchor} setAnchor={setAnchor} items={visible} byDay={byDay} onOpen={open} onToggle={toggle} onAdd={() => setAdding(anchor)} />}
          {view === 'week' && <WeekView start={range.start} byDay={byDay} onOpen={open} onToggle={toggle} onMove={move} onAdd={setAdding} />}
          {view === 'month' && <MonthView start={range.start} first={range.first} byDay={byDay} onPick={(d) => { setAnchor(d); nav('/planner/day', { replace: true }); }} />}
        </motion.div>
      </AnimatePresence>
      {inRange.length === 0 && view !== 'day' && (
        <Card className="soft" style={{ marginTop: 16 }}><Empty icon={CalendarDays} title="אין נתונים עדיין" text="אין משימות או אירועים בתקופה הזו. לחץ ״חדש״ כדי להוסיף." /></Card>
      )}

      <Sheet open={!!adding} onClose={() => setAdding(null)} title={adding ? `הוספה · ${relDay(adding) || shortDate(adding)}` : 'הוספה'}>
        <div className="sheet-body">
          <div className="list no-top inset">
            {[
              { k: 'events', label: 'אירוע ביומן', cat: 'סידורים' },
              { k: 'home_tasks', label: 'משימת בית', cat: 'בית' },
              ...businesses.map((b) => ({ k: `biz_tasks:${b.id}`, label: `משימה · ${b.name}`, cat: 'עבודה' })),
              ...(properties.length ? [{ k: 'prop_tasks', label: `משימת נכס · ${properties[0].name}`, cat: 'נכסים' }] : []),
            ].map((o) => (
              <button key={o.k} className="li clickable" style={{ width: '100%', textAlign: 'start' }} onClick={() => addNew(o.k, adding!)}>
                <span className="li-icon" style={{ background: `color-mix(in srgb, ${catVar(o.cat)} 22%, var(--surface))`, color: catVar(o.cat) }}>{o.k === 'events' ? <CalendarPlus size={18} /> : <Plus size={18} />}</span>
                <span className="li-main li-title">{o.label}</span><ChevronLeft size={16} className="muted" />
              </button>
            ))}
          </div>
        </div>
      </Sheet>
      {crud.home_tasks.sheet}{crud.biz_tasks.sheet}{crud.prop_tasks.sheet}{crud.events.sheet}
    </>
  );
}

export function usePlanItems(): Item[] {
  return useDerived(() => {
    const out: Item[] = [];
    const bizName = new Map(store.all('businesses').map((b) => [b.id, b.name]));
    const propName = new Map(store.all('properties').map((p) => [p.id, p.name]));
    for (const col of PLAN_COLLECTIONS) {
      for (const r of store.all(col)) {
        const date = dateOf(col, r);
        if (!date) continue;
        const done = col !== 'events' && !!r.done;
        const meta: string[] = [];
        if (col === 'biz_tasks' && bizName.get(r.business_id)) meta.push(bizName.get(r.business_id)!);
        if (col === 'prop_tasks' && propName.get(r.property_id)) meta.push(propName.get(r.property_id)!);
        if (r.place) meta.push(r.place);
        out.push({ key: col + r.id, col, rec: r, title: r.title, date, time: r.time || undefined, end: r.end_time || undefined, cat: categoryOf(col, r), done, late: col !== 'events' && !done && daysUntil(date) < 0, meta });
      }
    }
    return out;
  }, []);
}

/* ---------------- one item ---------------- */
function PlanCard({ i, compact, onOpen, onToggle, draggable }: { i: Item; compact?: boolean; onOpen: (i: Item) => void; onToggle: (i: Item, v: boolean) => void; draggable?: boolean }) {
  const canCheck = i.col !== 'events' && i.col !== 'google';
  return (
    <div className={`pl-item ${compact ? 'compact' : ''} ${i.done ? 'done' : ''} ${i.late ? 'late' : ''}`} style={catStyle(i.cat)} role="button" tabIndex={0}
      onClick={() => onOpen(i)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(i); }}
      draggable={draggable && i.col !== 'google'} onDragStart={(e: DragEvent) => { e.dataTransfer.setData('text/plain', i.key); e.dataTransfer.effectAllowed = 'move'; }}>
      {canCheck && <CheckBox checked={i.done} onChange={(v) => onToggle(i, v)} label={`סימון: ${i.title}`} />}
      <div className="li-main">
        {compact && i.time && <div className="pl-time" style={{ marginBottom: 1 }}>{i.time}</div>}
        <div className="li-title">{i.title}</div>
        {!compact && (
          <div className="li-meta">
            <span>{i.col === 'google' ? 'Google Calendar' : KIND[i.col]}</span>
            {i.rec?.assignee && <span className="row" style={{ gap: 3 }}><User size={12} />{i.rec.assignee}</span>}
            {i.meta.map((m) => <span key={m} className="row" style={{ gap: 3 }}>{i.rec?.place === m || i.g?.place === m ? <MapPin size={12} /> : null}{m}</span>)}
            {i.late && <span className="neg">באיחור · {relDay(i.date)}</span>}
          </div>
        )}
      </div>
      {i.time && !compact ? <span className="pl-time">{i.time}{!compact && i.end ? `–${i.end}` : ''}</span> : i.col === 'google' && !compact ? <ExternalLink size={14} className="muted" /> : null}
    </div>
  );
}

/* ---------------- day ---------------- */
function DayView({ anchor, setAnchor, items, byDay, onOpen, onToggle, onAdd }: { anchor: string; setAnchor: (d: string) => void; items: Item[]; byDay: (d: string) => Item[]; onOpen: (i: Item) => void; onToggle: (i: Item, v: boolean) => void; onAdd: () => void }) {
  const start = weekStart(anchor);
  const days = Array.from({ length: 7 }, (_, n) => addDays(start, n));
  const list = byDay(anchor);
  const overdue = anchor === today() ? items.filter((i) => i.late && i.date < anchor).sort((a, b) => a.date.localeCompare(b.date)) : [];
  const timed = list.filter((i) => i.time);
  const untimed = list.filter((i) => !i.time);
  return (
    <>
      <div className="daypick" role="group" aria-label="בחירת יום">
        {days.map((d, n) => {
          const its = byDay(d).filter((i) => !i.done);
          return (
            <button key={d} aria-pressed={d === anchor} className={d === today() ? 'today' : ''} onClick={() => setAnchor(d)} aria-label={`${DOW_LONG[n]} ${shortDate(d)}, ${its.length} פריטים`}>
              <span>{DOW[n]}</span><b>{Number(d.slice(8))}</b>
              <span className="dots">{its.slice(0, 4).map((i) => <i key={i.key} style={catStyle(i.cat)} />)}</span>
            </button>
          );
        })}
      </div>
      <QuickPlan date={anchor} />
      {overdue.length > 0 && (
        <>
          <div className="pl-section"><span className="cat-dot" style={{ background: 'var(--neg)' }} />באיחור · {overdue.length}</div>
          <div className="pl-list">{overdue.map((i) => <PlanCard key={i.key} i={i} onOpen={onOpen} onToggle={onToggle} />)}</div>
        </>
      )}
      {list.length === 0 ? (
        <Card className="soft" style={{ marginTop: 16 }}><Empty icon={CalendarDays} title="יום פנוי" text={`אין משימות או אירועים ב${relDay(anchor) === 'היום' ? 'יום הזה' : 'יום ' + DOW_LONG[dow(anchor)]}.`} action={<button className="btn btn-soft" onClick={onAdd}><Plus size={16} />הוספה ליום הזה</button>} /></Card>
      ) : (
        <>
          {timed.length > 0 && <div className="pl-section"><Clock size={14} />לפי שעה</div>}
          <div className="pl-list">{timed.map((i) => <PlanCard key={i.key} i={i} onOpen={onOpen} onToggle={onToggle} />)}</div>
          {untimed.length > 0 && <div className="pl-section">במהלך היום</div>}
          <div className="pl-list">{untimed.map((i) => <PlanCard key={i.key} i={i} onOpen={onOpen} onToggle={onToggle} />)}</div>
        </>
      )}
    </>
  );
}

/** One line to add a task for the chosen day, with its category. */
function QuickPlan({ date }: { date: string }) {
  const [v, setV] = useState('');
  const [cat, setCat] = useState('בית');
  const toast = useToast();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = v.trim(); if (!t) return;
    store.add('home_tasks', { title: t, due: date, category: cat, done: false, priority: 'רגילה', repeat: 'לא חוזר', assignee: '' });
    setV(''); toast('נוסף ליומן');
  };
  return (
    <form className="quick-add" style={{ padding: 0, marginBottom: 14 }} onSubmit={submit}>
      <select className="select" aria-label="סיווג" value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 'auto', height: 44, borderRadius: 999, flexShrink: 0, ...catStyle(cat), boxShadow: `inset 0 0 0 2px ${catVar(cat)}` }}>
        {CATEGORY_NAMES.map((c) => <option key={c}>{c}</option>)}
      </select>
      <input className="input" dir="auto" placeholder="משימה ליום הזה…" value={v} onChange={(e) => setV(e.target.value)} enterKeyHint="done" aria-label="משימה חדשה" />
      <button className="btn btn-primary" style={{ width: 44, padding: 0, flexShrink: 0 }} aria-label="הוספה" disabled={!v.trim()}><Plus size={18} /></button>
    </form>
  );
}

/* ---------------- week ---------------- */
function WeekView({ start, byDay, onOpen, onToggle, onMove, onAdd }: { start: string; byDay: (d: string) => Item[]; onOpen: (i: Item) => void; onToggle: (i: Item, v: boolean) => void; onMove: (key: string, d: string) => void; onAdd: (d: string) => void }) {
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="week">
      {Array.from({ length: 7 }, (_, n) => {
        const d = addDays(start, n);
        const list = byDay(d);
        return (
          <section key={d} className={`week-col ${d === today() ? 'today' : ''} ${over === d ? 'over' : ''} ${list.length ? '' : 'is-empty'}`} aria-label={`${DOW_LONG[n]} ${shortDate(d)}`}
            onDragOver={(e) => { e.preventDefault(); setOver(d); }} onDragLeave={() => setOver((o) => (o === d ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); onMove(e.dataTransfer.getData('text/plain'), d); }}>
            <div className="week-head"><span>{DOW_LONG[n]}</span><b>{Number(d.slice(8))}</b></div>
            {list.map((i) => <PlanCard key={i.key} i={i} compact draggable onOpen={onOpen} onToggle={onToggle} />)}
            <button className="week-add" onClick={() => onAdd(d)} aria-label={`הוספה ליום ${DOW_LONG[n]}`}><Plus size={16} /></button>
          </section>
        );
      })}
    </div>
  );
}

/* ---------------- month ---------------- */
function MonthView({ start, first, byDay, onPick }: { start: string; first: string; byDay: (d: string) => Item[]; onPick: (d: string) => void }) {
  const ym = first.slice(0, 7);
  return (
    <div className="month">
      {DOW.map((x) => <span key={x} className="dow">{x}</span>)}
      {Array.from({ length: 42 }, (_, n) => {
        const d = addDays(start, n);
        const list = byDay(d).filter((i) => !i.done);
        return (
          <button key={d} className={`month-cell ${d.slice(0, 7) !== ym ? 'out' : ''} ${d === today() ? 'today' : ''}`} onClick={() => onPick(d)} aria-label={`${shortDate(d)}: ${list.length} פריטים`}>
            <b>{Number(d.slice(8))}</b>
            {list.slice(0, 3).map((i) => <span key={i.key} className="ev" style={catStyle(i.cat)}>{i.time ? `${i.time} ` : ''}{i.title}</span>)}
            {list.length > 3 && <span className="more ev" style={{ background: 'none', borderInlineStart: 0 }}>ועוד {list.length - 3}</span>}
            <span className="dots">{list.slice(0, 5).map((i) => <i key={i.key} style={catStyle(i.cat)} />)}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Google Calendar ---------------- */
export function GoogleCard({ g }: { g: ReturnType<typeof useGoogle> }) {
  const toast = useToast();
  const s = g.status;
  return (
    <Card className="lg-6 md-12">
      <CardHead title="Google Calendar" sub="כל משתמש מחבר את היומן שלו">
        {s?.connected ? <Badge kind="pos">מחובר</Badge> : <Badge>לא מחובר</Badge>}
      </CardHead>
      {!s ? <div className="skeleton" style={{ height: 64 }} /> : !s.ready ? (
        <p className="muted" style={{ fontSize: 14 }}>החיבור לגוגל עוד לא הוגדר בשרת. צריך להוסיף ב־Vercel את מפתחות ה־OAuth של Google (GOOGLE_CLIENT_ID ו־GOOGLE_CLIENT_SECRET). אחרי זה כל אחד מחבר כאן את היומן שלו בלחיצה.</p>
      ) : s.connected ? (
        <div className="stack" style={{ gap: 12 }}>
          <div className="li" style={{ background: 'var(--surface-2)' }}>
            <span className="li-icon" style={{ color: 'var(--cat-google)' }}><CalendarDays size={18} /></span>
            <span className="li-main"><span className="li-title ltr" style={{ display: 'block', textAlign: 'start' }}>{s.email}</span><span className="li-meta">האירועים שלך מגוגל מופיעים ביומן בצבע כחול{s.synced_at ? ` · סונכרן ${relDay(s.synced_at.slice(0, 10))}` : ''}</span></span>
          </div>
          <label className="switch">
            <span>לשלוח לגוגל את המשימות והאירועים שמשויכים אליי</span>
            <Toggle checked={!!s.push} onChange={(v) => void g.setPush(v)} label="שליחה לגוגל" />
          </label>
          <div className="row wrap">
            <button className="btn btn-primary btn-sm" disabled={g.busy} onClick={async () => { try { const r = await g.syncNow(); toast(`סונכרן · ${r?.pushed ?? 0} פריטים נשלחו לגוגל`); } catch (e: any) { toast(e.message); } }}>
              <RefreshCw size={15} className={g.busy ? 'spin' : ''} />סנכרון עכשיו
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void g.disconnect()}><Unlink size={15} />ניתוק</button>
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <p className="muted" style={{ fontSize: 14 }}>חיבור פעם אחת: האירועים מהיומן שלך יופיעו כאן, והמשימות שמשויכות אליך יופיעו ביומן גוגל שלך (גם בטלפון).</p>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => void g.connect().catch((e) => toast(e.message))}><Link2 size={16} />חיבור ל־Google Calendar</button>
          {DEMO && <span className="meta">בהדגמה החיבור מדומה ומציג אירועי דוגמה.</span>}
        </div>
      )}
      {g.error && s?.connected && <p className="meta neg" style={{ marginTop: 8 }}>{g.error}</p>}
    </Card>
  );
}

/* ---------------- email reminders ---------------- */
export function RemindersCard({ onEdit }: { onEdit: () => void }) {
  const s = useReminderSettings();
  const pending = useDerived(() => PLAN_COLLECTIONS.flatMap((c) => store.all(c).filter((r) => r.assignee_email && !r.done && daysUntil(dateOf(c, r)) >= 0 && daysUntil(dateOf(c, r)) <= 7)).length, []);
  const when = s.days_before === 0 ? 'ביום עצמו' : s.days_before === 1 ? 'יום לפני' : `${s.days_before} ימים לפני`;
  return (
    <Card className="lg-6 md-12">
      <CardHead title="תזכורות במייל" sub="למי שצוות למשימה או לאירוע">
        <Badge kind={s.enabled ? 'pos' : 'none'}>{s.enabled ? 'פעיל' : 'כבוי'}</Badge>
      </CardHead>
      <div className="stack" style={{ gap: 10 }}>
        <div className="kv">
          <dt>כשמצוותים מישהו</dt><dd>{s.enabled && s.on_assign ? 'מייל מיד' : 'לא נשלח'}</dd>
          <dt>תזכורת</dt><dd>{s.enabled ? `${when}, ב־07:10` : 'לא נשלח'}</dd>
          <dt>בשבוע הקרוב</dt><dd>{pending ? `${pending} תזכורות מתוכננות` : 'אין נתונים עדיין'}</dd>
        </div>
        <button className="btn btn-soft btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onEdit}><Mail size={15} />עריכת הנוסח וההגדרות</button>
      </div>
    </Card>
  );
}

export function ReminderSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const saved = useReminderSettings();
  const { user } = useAuth();
  const members = useCollection('members');
  const toast = useToast();
  const isOwner = DEMO || members.some((m) => m.email === user?.email && m.role === 'owner');
  const [v, setV] = useState<ReminderSettings>(saved);
  const [which, setWhich] = useState<'assign' | 'before'>('assign');
  const lastField = useRef<'subject' | 'body'>('body');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) setV(saved); }, [open]);

  const subjKey = `${which}_subject` as const;
  const bodyKey = `${which}_body` as const;
  const sample: TemplateVars = { 'שם': 'נועה', 'משימה': 'לקבוע תור לרופא שיניים', 'תאריך': 'יום חמישי, 19 בנובמבר', 'שעה': 'בשעה 16:30', 'קטגוריה': 'בריאות', 'מאת': user?.name ?? 'אביהו', 'קישור': 'https://…/planner' };
  const insert = (k: string) => {
    const key = lastField.current === 'subject' ? subjKey : bodyKey;
    setV((x) => ({ ...x, [key]: `${x[key]}${x[key].endsWith(' ') || x[key].endsWith('\n') || !x[key] ? '' : ' '}{${k}}` }));
  };
  const save = () => { saveReminderSettings(v); toast('ההגדרות נשמרו'); onClose(); };
  const test = async () => {
    if (DEMO) { toast('בהדגמה לא נשלח מייל'); return; }
    try { await api('/api/notify', { body: { action: 'test', which, subject: v[subjKey], body: v[bodyKey] } }); toast('מייל ניסיון נשלח אליך'); } catch (e: any) { toast(e.message); }
  };

  return (
    <Sheet open={open} onClose={onClose} title="תזכורות במייל"
      footer={isOwner ? <div className="sheet-foot"><button className="btn btn-ghost" onClick={() => void test()}><Mail size={16} />ניסיון אליי</button><span className="grow" /><button className="btn btn-ghost" onClick={onClose}>ביטול</button><button className="btn btn-primary" onClick={save}>שמירה</button></div> : undefined}>
      <div className="sheet-body">
        {!isOwner && <p className="meta" style={{ marginBottom: 12 }}>רק הבעלים יכול לשנות את הנוסח.</p>}
        <fieldset disabled={!isOwner} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
          <label className="switch"><span>לשלוח תזכורות במייל</span><Toggle checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })} label="תזכורות פעילות" /></label>
          <label className="switch"><span>מייל מיד כשמצוותים מישהו</span><Toggle checked={v.on_assign} onChange={(x) => setV({ ...v, on_assign: x })} label="מייל בציוות" /></label>
          <label className="field"><span>מתי לשלוח תזכורת</span>
            <select className="select" value={v.days_before} onChange={(e) => setV({ ...v, days_before: Number(e.target.value) })}>
              <option value={0}>בבוקר של אותו יום</option><option value={1}>יום לפני</option><option value={2}>יומיים לפני</option><option value={3}>3 ימים לפני</option><option value={7}>שבוע לפני</option>
            </select>
            <small>נשלח בכל בוקר ב־07:10 שעון ישראל, רק למשימות פתוחות.</small>
          </label>
          <PillTabs id="tpl" items={[{ value: 'assign' as const, label: 'בציוות' }, { value: 'before' as const, label: 'תזכורת' }]} value={which} onChange={setWhich} />
          <label className="field"><span>שורת נושא</span>
            <input className="input" dir="auto" value={v[subjKey]} onFocus={() => (lastField.current = 'subject')} onChange={(e) => setV({ ...v, [subjKey]: e.target.value })} />
          </label>
          <label className="field"><span>תוכן ההודעה</span>
            <textarea className="textarea" dir="auto" rows={7} value={v[bodyKey]} onFocus={() => (lastField.current = 'body')} onChange={(e) => setV({ ...v, [bodyKey]: e.target.value })} />
          </label>
          <div className="field"><span>הוספת שדה (נכנס למקום שבו עמדת)</span>
            <div className="tpl-vars">{TEMPLATE_VARS.map((k) => <button type="button" key={k} onClick={() => insert(k)}>{`{${k}}`}</button>)}</div>
          </div>
          <div className="field"><span>תצוגה מקדימה</span>
            <div className="mail-preview"><b className="subj">{fillTemplate(v[subjKey], sample)}</b>{fillTemplate(v[bodyKey], sample)}</div>
          </div>
        </fieldset>
      </div>
    </Sheet>
  );
}


/* ---------------- home page: today + this week ---------------- */
export function HomeSchedule() {
  const nav = useNavigate();
  const toast = useToast();
  const items = usePlanItems();
  const start = weekStart(today());
  const google = useGoogle(start, addDays(start, 6));
  const crud = { home_tasks: useCrud('home_tasks'), biz_tasks: useCrud('biz_tasks'), prop_tasks: useCrud('prop_tasks'), events: useCrud('events') };
  const all = [...items, ...google.events.map((g): Item => ({ key: 'g' + g.id, col: 'google', g, title: g.title, date: g.date, time: g.allDay ? undefined : g.time, end: g.end_time, cat: GOOGLE_CATEGORY, done: false, late: false, meta: g.place ? [g.place] : [] }))];
  const byDay = (d: string) => all.filter((i) => i.date === d).sort(sortItems);
  const t = today();
  const todayList = byDay(t);
  const overdue = all.filter((i) => i.late).length;
  const open = (i: Item) => { if (i.col === 'google') { if (i.g?.link) window.open(i.g.link, '_blank', 'noopener'); return; } crud[i.col].openEdit(i.rec!); };
  const toggle = (i: Item, v: boolean) => { if (i.rec && i.col !== 'google' && i.col !== 'events') toggleTask(i.col, i.rec, v, toast); };
  const weekOpen = all.filter((i) => i.date >= start && i.date <= addDays(start, 6) && !i.done).length;

  return (
    <Card className="flush lg-12 schedule">
      <div className="schedule-grid">
        <div className="schedule-today">
          <div className="card-head" style={{ marginBottom: 12 }}>
            <div><h2>הלו״ז של היום</h2><div className="sub">{DOW_LONG[dow(t)]}, {shortDate(t)}{overdue ? ` · ${overdue} באיחור` : ''}</div></div>
            <Link className="card-link" to="/planner/day">ליום המלא<ChevronLeft size={14} /></Link>
          </div>
          {todayList.length === 0 ? <Empty icon={CalendarDays} title="יום פנוי" text="אין משימות או אירועים להיום." /> : (
            <div className="pl-list">{todayList.slice(0, 6).map((i) => <PlanCard key={i.key} i={i} onOpen={open} onToggle={toggle} />)}</div>
          )}
          {todayList.length > 6 && <Link className="card-link" to="/planner/day" style={{ marginTop: 6 }}>ועוד {todayList.length - 6}</Link>}
        </div>
        <div className="schedule-week">
          <div className="card-head" style={{ marginBottom: 12 }}>
            <div><h2>השבוע</h2><div className="sub">{shortDate(start)} – {shortDate(addDays(start, 6))} · {weekOpen ? `${weekOpen} פתוחים` : 'אין נתונים עדיין'}</div></div>
            <Link className="card-link" to="/planner/week">לשבוע<ChevronLeft size={14} /></Link>
          </div>
          <div className="month weekmini">
            {DOW.map((x) => <span key={x} className="dow">{x}</span>)}
            {Array.from({ length: 7 }, (_, n) => {
              const d = addDays(start, n);
              const list = byDay(d).filter((i) => !i.done);
              return (
                <button key={d} className={`month-cell ${d === t ? 'today' : ''} ${d < t ? 'out' : ''}`} onClick={() => nav(`/planner/day?d=${d}`)} aria-label={`${DOW_LONG[n]} ${shortDate(d)}: ${list.length} פריטים`}>
                  <b>{Number(d.slice(8))}</b>
                  {list.slice(0, 4).map((i) => <span key={i.key} className="ev" style={catStyle(i.cat)}>{i.time ? `${i.time} ` : ''}{i.title}</span>)}
                  {list.length > 4 && <span className="more ev" style={{ background: 'none', borderInlineStart: 0 }}>ועוד {list.length - 4}</span>}
                  <span className="dots">{list.slice(0, 5).map((i) => <i key={i.key} style={catStyle(i.cat)} />)}</span>
                </button>
              );
            })}
          </div>
          <div className="chips" style={{ marginTop: 12 }}>
            {[...new Set(all.filter((i) => i.date >= start && i.date <= addDays(start, 6) && !i.done).map((i) => i.cat))].map((c) => (
              <span key={c} className="badge" style={catStyle(c)}><span className="cat-dot" />{c}</span>
            ))}
          </div>
        </div>
      </div>
      {crud.home_tasks.sheet}{crud.biz_tasks.sheet}{crud.prop_tasks.sheet}{crud.events.sheet}
    </Card>
  );
}
