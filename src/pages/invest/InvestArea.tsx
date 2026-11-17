import { useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, BellRing, Building2, CalendarRange, Check, ChevronLeft, FileSignature, ImagePlus, Images, KeyRound, ListChecks, Mail, MessageCircle, Pencil, Phone, Trash2, TrendingUp, UserRound, Wallet, X } from 'lucide-react';
import type { Rec } from '../../data/types';
import { store, uploadPhoto, useCollection, useDerived, useRecord } from '../../data/store';
import { alerts, portfolio, propMetrics } from '../../data/derive';
import { daysUntil, longDate, money, monthLong, percent, relDay, shortDate, today } from '../../lib/format';
import { usePrefs } from '../../lib/prefs';
import { AddButton, useCrud } from '../../ui/crud';
import { Badge, Card, CardHead, DotNum, Empty, Kpi, Meter, PageHead, PillTabs, Stagger, TabBody, Toggle, easeOut } from '../../ui/kit';
import { TaskList } from '../../ui/lists';
import { useToast } from '../../ui/overlay';

const TONE = 'var(--tone-invest)';
const STATUS_KIND: Record<string, 'pos' | 'warn' | 'info' | 'none'> = { 'מושכר': 'pos', 'פנוי': 'warn', 'בשיפוץ': 'info', 'בהליך מכירה': 'none' };

/* ================= Portfolio ================= */
export function InvestArea() {
  const prefs = usePrefs();
  const nav = useNavigate();
  const props = useCollection('properties');
  const photos = useCollection('photos');
  const crud = useCrud('properties');
  const d = useDerived(() => ({ pf: portfolio(), list: alerts().filter((a) => a.area === 'invest') }), [prefs.hide]);

  return (
    <>
      <PageHead tag="ניהול השקעות" tone={TONE} title="הנכסים" sub={`${props.length} נכסים · שווי משוער ${money(d.pf.value)}`}>
        <Link to="/invest/alerts" className="btn btn-ghost"><BellRing size={15} />חוקי התראה</Link>
        <AddButton label="נכס חדש" onClick={() => crud.openNew()} />
      </PageHead>

      <Stagger>
        <Card className="hero hero-pink lg-5 md-12">
          <div className="spread"><span className="hero-label"><KeyRound size={16} />שכירות חודשית</span><span className="hero-chip">תפוסה {percent(d.pf.occupancy)}</span></div>
          <div className="hero-num"><DotNum value={prefs.hide ? '•••' : money(d.pf.rent).replace(/\s/g, '')} label={money(d.pf.rent)} /></div>
          <div className="hero-sub">אחרי משכנתאות: {money(d.pf.rent - d.pf.mortgage)} בחודש</div>
          <div style={{ marginTop: 16 }}>
            <div className="spread" style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}><span>נגבה החודש</span><span className="num">{money(d.pf.collected)} / {money(d.pf.expected)}</span></div>
            <div className="meter" style={{ background: 'rgb(255 255 255 / .22)' }}><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: d.pf.expected ? Math.min(1, d.pf.collected / d.pf.expected) : 0 }} transition={{ duration: 0.7, ease: easeOut, delay: 0.15 }} style={{ width: '100%', background: '#F9FCF8' }} /></div>
          </div>
        </Card>

        <Card className="flush lg-7 md-12">
          <div className="card-head" style={{ padding: '20px 20px 0', marginBottom: 6 }}><div><h2>התראות נכסים</h2><div className="sub">לפי החוקים שהגדרת</div></div><Link className="card-link" to="/invest/alerts">עריכת חוקים<ChevronLeft size={14} /></Link></div>
          {d.list.length === 0 ? <Empty icon={Check} title="הכול תקין" text="אין תשלומים באיחור, חוזים שמסתיימים או משימות תקועות." /> : (
            <div className="list">{d.list.slice(0, 5).map((a) => (
              <button key={a.id} className="li clickable" style={{ width: '100%', textAlign: 'start' }} onClick={() => nav(a.to)}>
                <span className="li-icon" style={{ color: a.level === 'danger' ? 'var(--neg)' : 'var(--warn)', background: a.level === 'danger' ? 'var(--neg-bg)' : 'var(--warn-bg)' }}><BellRing size={18} /></span>
                <span className="li-main"><span className="li-title" style={{ display: 'block' }}>{a.title}</span><span className="li-meta">{a.detail}</span></span><ChevronLeft size={16} className="muted" />
              </button>
            ))}</div>
          )}
        </Card>

        {props.length === 0 && <Card className="lg-12"><Empty icon={Building2} title="עוד אין נכסים" text="הוסף נכס ראשון כדי לעקוב אחרי שוכר, חוזה, תשלומים ומשימות." action={<AddButton label="נכס חדש" onClick={() => crud.openNew()} />} /></Card>}

        {props.map((p) => {
          const m = propMetrics(p);
          const cover = photos.find((ph) => ph.property_id === p.id);
          return (
            <Card key={p.id} className="lg-4 md-6" to={`/invest/${p.id}`} style={{ padding: 12 }}>
              <div className="prop-cover">
                {cover ? <img src={cover.url} alt="" loading="lazy" /> : <Building2 size={40} opacity={0.6} />}
                <Badge kind={STATUS_KIND[p.status] ?? 'none'}>{p.status}</Badge>
              </div>
              <div style={{ padding: '14px 8px 6px' }}>
                <div className="spread"><b style={{ fontWeight: 500, fontSize: 16 }}>{p.name}</b>{p.monthly_rent ? <span className="num" style={{ fontWeight: 500 }}>{money(p.monthly_rent)}</span> : null}</div>
                <div className="li-meta" style={{ marginTop: 4 }}>
                  <span>{m.tenant?.name ?? 'ללא שוכר'}</span>
                  {m.lease && <span>· חוזה עד {shortDate(m.lease.end)}</span>}
                </div>
                <div className="chips" style={{ marginTop: 10 }}>
                  {m.late.length > 0 && <Badge kind="neg">חוב {money(m.lateTotal)}</Badge>}
                  {m.lease && daysUntil(m.lease.end) <= 90 && daysUntil(m.lease.end) >= 0 && <Badge kind="warn">חוזה מסתיים {relDay(m.lease.end)}</Badge>}
                  {m.yieldGross > 0 && <Badge>תשואה {(m.yieldGross * 100).toFixed(1)}%</Badge>}
                </div>
              </div>
            </Card>
          );
        })}
      </Stagger>
      {crud.sheet}
    </>
  );
}

/* ================= Property ================= */
const PTABS = [
  { value: 'details', label: 'מצב ופרטים', icon: Building2 },
  { value: 'lease', label: 'שוכר וחוזה', icon: FileSignature },
  { value: 'payments', label: 'תשלומים', icon: Wallet },
  { value: 'tasks', label: 'משימות', icon: ListChecks },
  { value: 'photos', label: 'תמונות', icon: Images },
] as const;
type PTab = (typeof PTABS)[number]['value'];

export function Property() {
  const { propId, tab = 'details' } = useParams();
  const nav = useNavigate();
  const p = useRecord('properties', propId);
  const crud = useCrud('properties');
  const tasks = useCollection('prop_tasks', (t) => t.property_id === propId && !t.done, [propId]);
  const photos = useCollection('photos', (t) => t.property_id === propId, [propId]);

  if (!p) return <><PageHead title="הנכס לא נמצא" /><Link className="btn btn-soft" to="/invest"><ArrowRight size={16} />חזרה לנכסים</Link></>;
  const View = { details: Details, lease: LeaseTab, payments: Payments, tasks: PropTasks, photos: Photos }[tab as PTab] ?? Details;

  return (
    <>
      <Link to="/invest" className="card-link" style={{ marginTop: 12 }}><ArrowRight size={15} />כל הנכסים</Link>
      <PageHead tag={p.type} tone={TONE} title={p.name} sub={<>{p.address}{p.rooms ? ` · ${p.rooms}` : ''}</>}>
        <Badge kind={STATUS_KIND[p.status] ?? 'none'}>{p.status}</Badge>
        <button className="btn btn-ghost" onClick={() => crud.openEdit(p)}><Pencil size={15} />עריכה</button>
      </PageHead>
      <div className="subnav"><PillTabs id="prop" items={PTABS.map((t) => ({ ...t, count: t.value === 'tasks' ? tasks.length : t.value === 'photos' ? photos.length : undefined }))} value={tab as PTab} onChange={(v) => nav(`/invest/${p.id}${v === 'details' ? '' : '/' + v}`)} /></div>
      <TabBody id={tab}><View p={p} /></TabBody>
      {crud.sheet}
    </>
  );
}

function Details({ p }: { p: Rec }) {
  const prefs = usePrefs();
  const m = useDerived(() => propMetrics(p), [p, prefs.hide]);
  const mine = useDerived(() => alerts().filter((a) => a.to.includes(p.id)), [p.id]);
  const y = useDerived(() => {
    const since = new Date(); since.setFullYear(since.getFullYear() - 1);
    const from = since.toISOString().slice(0, 7);
    const rows = store.all('rent_payments').filter((r) => r.property_id === p.id && (r.month || '') > from && (r.month || '') <= today().slice(0, 7));
    const collected = rows.reduce((a, r) => a + (r.paid_amount || 0), 0);
    const expected = rows.reduce((a, r) => a + (r.amount || 0), 0);
    const mortgage = (p.mortgage_monthly || 0) * rows.length;
    const lateCount = rows.filter((r) => (r.paid_amount || 0) < (r.amount || 0) && daysUntil(r.due_date) < 0).length;
    return { collected, expected, mortgage, net: collected - mortgage, months: rows.length, lateCount };
  }, [p, prefs.hide]);
  return (
    <Stagger>
      <Card className="lg-3 md-6 sm-6"><Kpi label="שכירות חודשית" icon={KeyRound} tone={TONE} value={p.monthly_rent ? money(p.monthly_rent) : 'אין נתונים עדיין'} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="נטו אחרי משכנתא" icon={Wallet} tone={TONE} value={<span className={m.net < 0 ? 'neg' : ''}>{money(m.net)}</span>} foot={p.mortgage_monthly ? `החזר ${money(p.mortgage_monthly)}` : 'ללא משכנתא'} /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="תשואה ברוטו" icon={TrendingUp} tone={TONE} value={m.yieldGross ? `${(m.yieldGross * 100).toFixed(1)}%` : 'אין נתונים עדיין'} foot="שכירות שנתית / מחיר רכישה" /></Card>
      <Card className="lg-3 md-6 sm-6"><Kpi label="שווי משוער" icon={Building2} tone={TONE} value={money(p.market_value)} foot={p.purchase_price ? `נרכש ב־${money(p.purchase_price)}` : undefined} /></Card>

      <Card className="flush lg-7 md-12">
        <div className="card-head" style={{ padding: '20px 20px 0', marginBottom: 6 }}><h2>סטטוס הנכס</h2></div>
        {mine.length === 0 ? <Empty icon={Check} title="הכול תקין בנכס הזה" /> : (
          <div className="list">{mine.map((a) => (
            <Link key={a.id} to={a.to} className="li clickable" style={{ color: 'inherit' }}>
              <span className="li-icon" style={{ color: a.level === 'danger' ? 'var(--neg)' : 'var(--warn)', background: a.level === 'danger' ? 'var(--neg-bg)' : 'var(--warn-bg)' }}><BellRing size={18} /></span>
              <span className="li-main"><span className="li-title" style={{ display: 'block' }}>{a.title.split(' · ').slice(1).join(' · ') || a.title}</span><span className="li-meta">{a.detail}</span></span>
            </Link>
          ))}</div>
        )}
      </Card>
      <Card className="lg-5 md-12">
        <CardHead title="פרטים" />
        <dl className="kv">
          <dt>שוכר</dt><dd>{m.tenant?.name ?? '—'}</dd>
          <dt>חוזה עד</dt><dd>{m.lease ? longDate(m.lease.end) : '—'}</dd>
          <dt>ביטוח מבנה עד</dt><dd>{longDate(p.insurance_until)}</dd>
          <dt>סוג</dt><dd>{p.type}</dd>
          <dt>גודל</dt><dd>{p.rooms || '—'}</dd>
        </dl>
      </Card>

      <Card className="lg-12">
        <CardHead title="12 החודשים האחרונים" sub="מה נכנס מהנכס בפועל, ומה נשאר אחרי המשכנתא" />
        {y.expected === 0 ? <p className="meta">אין תשלומי שכירות רשומים עדיין.</p> : (
          <>
            <div className="grid" style={{ gap: 12 }}>
              <div className="lg-3 md-6 sm-6 card soft" style={{ padding: 16 }}><Kpi label="שכירות שנגבתה" value={money(y.collected)} foot={`מתוך ${money(y.expected)}`} /></div>
              <div className="lg-3 md-6 sm-6 card soft" style={{ padding: 16 }}><Kpi label="החזרי משכנתא" value={money(y.mortgage)} foot={`${y.months} חודשים`} /></div>
              <div className="lg-3 md-6 sm-6 card soft" style={{ padding: 16 }}><Kpi label="נטו בפועל" value={<span className={y.net < 0 ? 'neg' : ''}>{money(y.net)}</span>} foot={p.market_value ? `${(y.net / p.market_value * 100).toFixed(1)}% מהשווי` : undefined} /></div>
              <div className="lg-3 md-6 sm-6 card soft" style={{ padding: 16 }}><Kpi label="חודשים שלא שולמו במלואם" value={String(y.lateCount)} foot={y.lateCount ? `מתוך ${y.months} חודשים` : 'הכול שולם'} /></div>
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="spread" style={{ marginBottom: 6 }}><span className="label">שיעור גבייה</span><b className="num" style={{ fontWeight: 500 }}>{percent(y.collected / y.expected)}</b></div>
              <Meter value={y.collected} max={y.expected} tone={TONE} />
            </div>
          </>
        )}
      </Card>
    </Stagger>
  );
}

function LeaseTab({ p }: { p: Rec }) {
  const tenants = useCollection('tenants', (t) => t.property_id === p.id, [p.id]);
  const leases = useCollection('leases', (t) => t.property_id === p.id, [p.id]);
  const tCrud = useCrud('tenants', { property_id: p.id });
  const lCrud = useCrud('leases', { property_id: p.id });
  const t = tenants[0];
  const sorted = [...leases].sort((a, b) => b.end.localeCompare(a.end));
  const cur = sorted[0];
  const total = cur ? Math.max(1, daysUntil(cur.end) - daysUntil(cur.start)) : 1;
  const passed = cur ? -daysUntil(cur.start) : 0;

  return (
    <Stagger>
      <Card className="lg-5 md-12" style={{ alignSelf: 'start' }}>
        <CardHead title="פרטי השוכר">{t ? <button className="btn btn-soft btn-sm" onClick={() => tCrud.openEdit(t)}><Pencil size={14} />עריכה</button> : <AddButton small label="שוכר" onClick={() => tCrud.openNew()} />}</CardHead>
        {!t ? <Empty icon={UserRound} title="אין שוכר" text="הנכס מסומן בלי שוכר פעיל." /> : (
          <>
            <div className="row" style={{ marginBottom: 16 }}><span className="avatar" style={{ width: 52, height: 52, fontSize: 20 }}>{t.name.slice(0, 1)}</span><div><b style={{ fontWeight: 500, fontSize: 17 }}>{t.name}</b><div className="meta">בנכס מאז {longDate(t.since)}</div></div></div>
            <div className="chips" style={{ marginBottom: 16 }}>
              {t.phone && <a className="chip" href={`tel:${t.phone}`}><Phone size={14} /><span className="ltr">{t.phone}</span></a>}
              {t.phone && <a className="chip" href={`https://wa.me/972${t.phone.replace(/\D/g, '').replace(/^0/, '')}`} target="_blank" rel="noreferrer"><MessageCircle size={14} />וואטסאפ</a>}
              {t.email && <a className="chip" href={`mailto:${t.email}`}><Mail size={14} />מייל</a>}
            </div>
            <dl className="kv"><dt>אמצעי תשלום</dt><dd>{t.pay_method}</dd>{t.note && <><dt>הערות</dt><dd>{t.note}</dd></>}</dl>
          </>
        )}
      </Card>

      <Card className="lg-7 md-12">
        <CardHead title="הסכם שכירות" sub={cur ? `${longDate(cur.start)} – ${longDate(cur.end)}` : undefined}>{cur ? <button className="btn btn-soft btn-sm" onClick={() => lCrud.openEdit(cur)}><Pencil size={14} />עריכה</button> : null}<AddButton small label={cur ? 'חידוש' : 'חוזה'} onClick={() => lCrud.openNew(cur ? { start: cur.end, monthly_rent: cur.monthly_rent, indexation: cur.indexation } : undefined)} /></CardHead>
        {!cur ? <Empty icon={FileSignature} title="אין חוזה" text="הוסף את פרטי ההסכם כדי לקבל התראה לפני הסיום." /> : (
          <>
            <div className="spread" style={{ fontSize: 13, marginBottom: 6 }}><span className="muted">{daysUntil(cur.end) >= 0 ? `נשארו ${daysUntil(cur.end)} ימים` : 'החוזה הסתיים'}</span>{daysUntil(cur.end) <= 90 && <Badge kind={daysUntil(cur.end) <= 30 ? 'neg' : 'warn'}>זמן לחדש</Badge>}</div>
            <Meter value={passed} max={total} tone={TONE} />
            <div className="divider" />
            <dl className="kv">
              <dt>שכירות</dt><dd>{money(cur.monthly_rent)} לחודש</dd>
              <dt>הצמדה</dt><dd>{cur.indexation}</dd>
              <dt>בטוחות</dt><dd>{cur.guarantee || '—'}</dd>
              <dt>אופציה</dt><dd>{cur.option || '—'}</dd>
              <dt>חוזה חתום</dt><dd>{cur.link ? <a href={cur.link} target="_blank" rel="noreferrer">פתיחת הקובץ</a> : 'לא צורף'}</dd>
            </dl>
            {sorted.length > 1 && <p className="meta" style={{ marginTop: 14 }}>{sorted.length - 1} חוזים קודמים שמורים.</p>}
          </>
        )}
      </Card>
      {tCrud.sheet}{lCrud.sheet}
    </Stagger>
  );
}

function Payments({ p }: { p: Rec }) {
  const rows = useCollection('rent_payments', (t) => t.property_id === p.id, [p.id]);
  const crud = useCrud('rent_payments', { property_id: p.id }, { preset: { amount: p.monthly_rent } });
  const toast = useToast();
  const sorted = [...rows].sort((a, b) => b.month.localeCompare(a.month));
  const year = sorted.filter((r) => r.month.startsWith(today().slice(0, 4)));
  const paid = year.reduce((a, r) => a + (r.paid_amount || 0), 0);
  const debt = sorted.filter((r) => daysUntil(r.due_date) < 0).reduce((a, r) => a + Math.max(0, r.amount - (r.paid_amount || 0)), 0);

  return (
    <Stagger>
      <Card className="lg-4 md-6 sm-6"><Kpi label="נגבה השנה" icon={Wallet} tone={TONE} value={money(paid)} /></Card>
      <Card className="lg-4 md-6 sm-6"><Kpi label="חוב פתוח" icon={CalendarRange} tone={TONE} value={<span className={debt ? 'neg' : ''}>{money(debt)}</span>} foot={debt ? 'תשלומים שעבר מועדם' : 'אין חובות'} /></Card>
      <Card className="lg-4 md-12" style={{ display: 'flex', alignItems: 'center' }}><AddButton label="תשלום / חודש חדש" onClick={() => crud.openNew()} /></Card>
      <Card className="flush lg-12">
        {sorted.length === 0 ? <Empty icon={Wallet} title="אין תשלומים עדיין" text="הוסף את החודש הראשון. אפשר לסמן ״שולם״ בלחיצה." /> : (
          <div className="list">
            {sorted.map((r) => {
              const full = (r.paid_amount || 0) >= r.amount;
              const late = !full && daysUntil(r.due_date) < 0;
              return (
                <div key={r.id} className="li clickable" onClick={() => crud.openEdit(r)}>
                  <span className="li-icon" style={full ? { background: 'var(--pos-bg)', color: 'var(--pos)' } : late ? { background: 'var(--neg-bg)', color: 'var(--neg)' } : undefined}>{full ? <Check size={18} /> : <CalendarRange size={18} />}</span>
                  <div className="li-main"><div className="li-title">{monthLong(r.month)}</div><div className="li-meta">{full ? `שולם ${shortDate(r.paid_date)}` : late ? <span className="neg">{-daysUntil(r.due_date)} ימים באיחור</span> : `לתשלום ${relDay(r.due_date)}`}{!full && r.paid_amount ? ` · שולם חלקית ${money(r.paid_amount)}` : ''}</div></div>
                  <div className="li-end"><span className="li-amount">{money(r.amount)}</span>
                    {full ? <Badge kind="pos">שולם</Badge> : <button className="btn btn-soft btn-sm" onClick={(e) => { e.stopPropagation(); const prev = { paid_amount: r.paid_amount, paid_date: r.paid_date }; store.update('rent_payments', r.id, { paid_amount: r.amount, paid_date: today() }); toast('סומן כשולם', () => store.update('rent_payments', r.id, prev)); }}>סמן שולם</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {crud.sheet}
    </Stagger>
  );
}

function PropTasks({ p }: { p: Rec }) {
  const rows = useCollection('prop_tasks', (t) => t.property_id === p.id, [p.id]);
  return <Stagger><Card className="flush lg-12"><TaskList collection="prop_tasks" rows={rows} scope={{ property_id: p.id }} emptyText="תיקונים, שיפוץ, ביטוח, מסירת מפתח…" /></Card></Stagger>;
}

function Photos({ p }: { p: Rec }) {
  const rows = useCollection('photos', (t) => t.property_id === p.id, [p.id]);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const [view, setView] = useState<Rec | null>(null);

  const add = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setBusy(list.length);
    for (const f of list) {
      try { const { url, path } = await uploadPhoto(f, p.id); store.add('photos', { property_id: p.id, url, path, name: f.name, taken: today() }); }
      catch { toast('העלאה נכשלה: ' + f.name); }
      setBusy((b) => b - 1);
    }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files); };

  return (
    <Stagger>
      <Card className="lg-12">
        <CardHead title="תמונות הנכס" sub={rows.length ? `${rows.length} תמונות` : 'מצב הנכס, מסירה, נזקים, שיפוץ'} />
        <div className="photos">
          <button className={`dropzone ${over ? 'over' : ''}`} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
            <ImagePlus size={24} />{busy > 0 ? `מעלה ${busy}…` : <>העלאת תמונות<span className="meta hide-sm">או גרירה לכאן</span></>}
          </button>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = ''; }} />
          <AnimatePresence>
            {rows.map((ph) => (
              <motion.div key={ph.id} layout className="photo" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.14 } }} transition={{ duration: 0.26, ease: easeOut }}>
                <button style={{ display: 'block', width: '100%', height: '100%' }} onClick={() => setView(ph)} aria-label={`הגדלת ${ph.name}`}><img src={ph.url} alt={ph.name} loading="lazy" /></button>
                <button className="icon-btn rm" aria-label="מחיקת תמונה" onClick={() => { const undo = store.remove('photos', ph.id); toast('התמונה נמחקה', undo); }}><Trash2 size={15} /></button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </Card>
      <AnimatePresence>
        {view && (
          <motion.div className="scrim" style={{ display: 'grid', placeItems: 'center', padding: 20, zIndex: 70, background: 'rgb(8 32 26 / .8)' }} onClick={() => setView(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.14 } }} role="dialog" aria-label={view.name}>
            <motion.img src={view.url} alt={view.name} style={{ maxHeight: '86dvh', maxWidth: '100%', borderRadius: 20 }} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }} transition={{ duration: 0.22, ease: easeOut }} />
            <button className="icon-btn" style={{ position: 'fixed', top: 16, insetInlineStart: 16 }} aria-label="סגירה" autoFocus onKeyDown={(e) => e.key === 'Escape' && setView(null)}><X size={18} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </Stagger>
  );
}

/* ================= Alert rules ================= */
export function AlertRules() {
  const rules = useCollection('alert_rules');
  const crud = useCrud('alert_rules');
  const active = useDerived(() => alerts().filter((a) => a.area === 'invest'));
  const explain = (r: Rec) => ({
    'איחור בתשלום שכירות': `כששכירות לא שולמה ${r.threshold} ימים אחרי המועד`,
    'סיום חוזה מתקרב': `${r.threshold} ימים לפני סיום החוזה`,
    'ביטוח מבנה פג': `${r.threshold} ימים לפני שפג ביטוח המבנה`,
    'משימה פתוחה זמן רב': `כשמשימה פתוחה ${r.threshold} ימים אחרי היעד`,
    'נכס פנוי': 'כשנכס מסומן פנוי',
  }[r.kind as string] ?? r.kind);

  return (
    <>
      <Link to="/invest" className="card-link" style={{ marginTop: 12 }}><ArrowRight size={15} />כל הנכסים</Link>
      <PageHead tag="ניהול השקעות" tone={TONE} title="חוקי התראה" sub="מגדירים פעם אחת מתי להתריע. המערכת בודקת כל נכס לפי החוקים."><AddButton label="חוק חדש" onClick={() => crud.openNew()} /></PageHead>
      <Stagger>
        <Card className="flush lg-8 md-12">
          {rules.length === 0 ? <Empty icon={BellRing} title="אין חוקים" text="בלי חוקים לא יופיעו התראות על נכסים." /> : (
            <div className="list">{rules.map((r) => (
              <div key={r.id} className="li clickable" onClick={() => crud.openEdit(r)}>
                <span className="li-icon"><BellRing size={18} /></span>
                <div className="li-main"><div className="li-title">{r.name}</div><div className="li-meta">{explain(r)} · {r.channel}</div></div>
                <div className="li-end" onClick={(e) => e.stopPropagation()}><Toggle checked={!!r.enabled} onChange={(v) => store.update('alert_rules', r.id, { enabled: v })} label={`הפעלת ${r.name}`} /></div>
              </div>
            ))}</div>
          )}
        </Card>
        <Card className="soft lg-4 md-12" style={{ alignSelf: 'start' }}>
          <Kpi label="התראות פעילות כרגע" icon={BellRing} tone={TONE} value={<span className="num">{active.length}</span>} />
          <p className="meta" style={{ marginTop: 12 }}>התראות בערוץ ״באפליקציה״ פעילות כבר עכשיו. שליחה בוואטסאפ ובמייל תתחיל אחרי חיבור Kapso ושירות המייל במסך ההגדרות.</p>
        </Card>
      </Stagger>
      {crud.sheet}
    </>
  );
}
