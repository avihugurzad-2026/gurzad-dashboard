import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, Building2, Briefcase, Eye, EyeOff, Home, LayoutGrid, LogOut, MessageCircle, Moon, MoreHorizontal, Plus, Activity, Settings, ShoppingBasket, Sun, Users, Receipt, ListChecks, AlertTriangle, CircleAlert, ChevronLeft, X, CalendarDays } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { DEMO } from '../lib/config';
import { isDark, setPrefs, usePrefs } from '../lib/prefs';
import { alerts } from '../data/derive';
import { useDerived } from '../data/store';
import { spring, easeOut } from '../ui/kit';
import { Sheet } from '../ui/overlay';
import { useCrud } from '../ui/crud';
import { InstallSteps } from '../pages/Notifications';
import { dismissInstall, haptic, isIOS, promptInstall, setBadge, useInstall } from '../lib/pwa';

const AREAS = [
  { to: '/', label: 'סקירה', icon: LayoutGrid, end: true },
  { to: '/home', label: 'בית', icon: Home },
  { to: '/business', label: 'עסקים', icon: Briefcase },
  { to: '/invest', label: 'השקעות', icon: Building2 },
  { to: '/planner', label: 'יומן', icon: CalendarDays },
];
const TOOLS = [
  { to: '/notifications', label: 'התראות', icon: Bell },
  { to: '/whatsapp', label: 'וואטסאפ', icon: MessageCircle },
  { to: '/status', label: 'סטטוס מערכות', icon: Activity },
  { to: '/team', label: 'צוות ושיתוף', icon: Users },
  { to: '/settings', label: 'הגדרות וחיבורים', icon: Settings },
];

const activeArea = (path: string) => AREAS.slice(1).find((a) => path.startsWith(a.to))?.to ?? (path === '/' ? '/' : '');

export function AppShell() {
  const { user, signOut } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const prefs = usePrefs();
  const cur = activeArea(loc.pathname);
  const [bell, setBell] = useState(false);
  const [more, setMore] = useState(false);
  const [quick, setQuick] = useState(false);
  const [how, setHow] = useState(false);
  const list = useDerived(() => alerts());
  const bellRef = useRef<HTMLDivElement>(null);
  const inst = useInstall();
  const mobile = () => matchMedia('(max-width: 767px)').matches;
  useEffect(() => { setBadge(list.length); }, [list.length]);

  const txCrud = useCrud('transactions');
  const taskCrud = useCrud('home_tasks');
  const shopCrud = useCrud('shopping');
  const eventCrud = useCrud('events');

  useEffect(() => { setBell(false); setMore(false); setQuick(false); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => {
    if (!bell) return;
    const h = (e: MouseEvent) => { if (!bellRef.current?.contains(e.target as Node)) setBell(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setBell(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [bell]);

  const dark = isDark();

  return (
    <div className="app">
      <div className="brand"><NavLink to="/" className="brand-mark" aria-label="דף הבית"><span /></NavLink></div>

      <header className="topbar">
        <nav className="pill-nav" aria-label="תחומים">
          {AREAS.map((a) => {
            const on = cur === a.to;
            return (
              <NavLink key={a.to} to={a.to} end={a.end} className="pill" aria-current={on ? 'page' : undefined}>
                {on && <motion.span layoutId="area-pill" className="pill-bg" transition={spring} />}
                <a.icon size={16} /><span>{a.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="show-sm" style={{ fontWeight: 500, fontSize: 17 }}>
          <span className="row" style={{ gap: 10 }}><span className="brand-mark" style={{ width: 36, height: 36, borderRadius: 12 }}><span style={{ width: 11, height: 11 }} /></span>גורזאד</span>
        </div>

        <div className="topbar-actions">
          {DEMO && <span className="demo-banner hide-md">מצב הדגמה · נתוני דוגמה</span>}
          <button className="icon-btn hide-sm" onClick={() => setPrefs({ hide: !prefs.hide })} aria-label={prefs.hide ? 'הצג סכומים' : 'הסתר סכומים'} aria-pressed={prefs.hide}>
            {prefs.hide ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
          <button className="icon-btn hide-sm" onClick={() => setPrefs({ theme: dark ? 'light' : 'dark' })} aria-label={dark ? 'מצב בהיר' : 'מצב כהה'}>
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div ref={bellRef} style={{ position: 'relative' }}>
            <button className="icon-btn" onClick={() => (mobile() ? nav('/notifications') : setBell((b) => !b))} aria-label={`התראות (${list.length})`} aria-expanded={bell}>
              <Bell size={18} />{list.length > 0 && <span className="dot-badge" />}
            </button>
            <AnimatePresence>
              {bell && (
                <motion.div role="dialog" aria-label="התראות" className="card flush"
                  style={{ position: 'absolute', top: 52, insetInlineEnd: 0, width: 'min(380px, calc(100vw - 32px))', boxShadow: 'var(--shadow-pop)', zIndex: 50, transformOrigin: 'top left' }}
                  initial={{ opacity: 0, scale: 0.96, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }} transition={{ duration: 0.18, ease: easeOut }}>
                  <div className="spread" style={{ padding: '16px 20px 10px' }}><b style={{ fontWeight: 500 }}>דורש תשומת לב</b><span className="meta">{list.length} פריטים</span></div>
                  <div className="list" style={{ maxHeight: 380, overflowY: 'auto' }}>
                    {list.length === 0 && <div className="empty" style={{ padding: 28 }}><b>הכול תקין</b><p>אין שום דבר שמחכה לך.</p></div>}
                    {list.slice(0, 12).map((a) => (
                      <button key={a.id} className="li clickable" style={{ textAlign: 'start', width: '100%' }} onClick={() => nav(a.to)}>
                        <span className="li-icon" style={{ color: a.level === 'danger' ? 'var(--neg)' : 'var(--warn)', background: a.level === 'danger' ? 'var(--neg-bg)' : 'var(--warn-bg)' }}>
                          {a.level === 'danger' ? <CircleAlert size={18} /> : <AlertTriangle size={18} />}
                        </span>
                        <span className="li-main"><span className="li-title" style={{ display: 'block' }}>{a.title}</span><span className="li-meta">{a.detail}</span></span>
                        <ChevronLeft size={16} className="muted" />
                      </button>
                    ))}
                  </div>
                  <button className="btn btn-soft btn-sm" style={{ margin: '4px 12px 12px', width: 'calc(100% - 24px)' }} onClick={() => nav('/notifications')}>כל ההתראות וההגדרות</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="user-chip">
            <span className="avatar">{(user?.name || '?').slice(0, 1)}</span>
            <span className="who"><b>{user?.name}</b><span className="ltr">{user?.email}</span></span>
          </div>
        </div>
      </header>

      <aside className="rail" aria-label="כלים">
        <div className="rail-group">
          {TOOLS.map((t) => (
            <NavLink key={t.to} to={t.to} className="rail-btn" aria-label={t.label}>
              <t.icon size={19} /><span className="tip">{t.label}</span>
            </NavLink>
          ))}
        </div>
        <div className="rail-spacer" />
        <div className="rail-group">
          <button className="rail-btn" onClick={() => signOut()} aria-label="יציאה"><LogOut size={18} /><span className="tip">יציאה</span></button>
        </div>
      </aside>

      <main className="main">
        <div className="page">
          {!inst.standalone && !inst.dismissed && (inst.canPrompt || isIOS) && loc.pathname === '/' && (
            <div className="install-bar show-sm-flex">
              <span className="brand-mark" style={{ width: 40, height: 40, borderRadius: 13, flexShrink: 0 }}><span style={{ width: 12, height: 12 }} /></span>
              <span className="li-main"><b>להתקין כאפליקציה</b><span className="li-meta">מסך מלא והתראות לטלפון</span></span>
              <button className="btn btn-primary btn-sm" onClick={() => (inst.canPrompt ? void promptInstall() : setHow(true))}>{inst.canPrompt ? 'התקנה' : 'איך?'}</button>
              <button className="icon-btn" style={{ width: 36, height: 36, boxShadow: 'none', background: 'transparent', border: 0 }} aria-label="סגירה" onClick={dismissInstall}><X size={16} /></button>
            </div>
          )}
          <Outlet />
        </div>
      </main>

      {/* ---- mobile ---- */}
      <button className="fab" aria-label="הוספה מהירה" onClick={() => { haptic(); setQuick(true); }}><Plus size={24} /></button>
      <nav className="tabbar" aria-label="ניווט ראשי">
        {AREAS.map((a) => {
          const on = cur === a.to;
          return (
            <NavLink key={a.to} to={a.to} end={a.end} className="tab" aria-current={on ? 'page' : undefined}>
              {on && <motion.span layoutId="tab-pill" className="tab-bg" transition={spring} />}
              <a.icon size={20} /><span>{a.label}</span>
            </NavLink>
          );
        })}
        <button className="tab" onClick={() => setMore(true)} aria-current={cur === '' ? 'page' : undefined}>
          {cur === '' && <motion.span layoutId="tab-pill" className="tab-bg" transition={spring} />}
          <MoreHorizontal size={20} /><span>עוד</span>
        </button>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="עוד">
        <div className="sheet-body">
          <div className="list no-top inset">
            {TOOLS.map((t) => (
              <NavLink key={t.to} to={t.to} className="li" style={{ color: 'inherit' }}>
                <span className="li-icon"><t.icon size={18} /></span><span className="li-main li-title">{t.label}</span><ChevronLeft size={16} className="muted" />
              </NavLink>
            ))}
            <button className="li" style={{ width: '100%', textAlign: 'start' }} onClick={() => setPrefs({ hide: !prefs.hide })}>
              <span className="li-icon">{prefs.hide ? <EyeOff size={18} /> : <Eye size={18} />}</span><span className="li-main li-title">{prefs.hide ? 'הצג סכומים' : 'הסתר סכומים'}</span>
            </button>
            <button className="li" style={{ width: '100%', textAlign: 'start' }} onClick={() => setPrefs({ theme: dark ? 'light' : 'dark' })}>
              <span className="li-icon">{dark ? <Sun size={18} /> : <Moon size={18} />}</span><span className="li-main li-title">{dark ? 'מצב בהיר' : 'מצב כהה'}</span>
            </button>
            <button className="li" style={{ width: '100%', textAlign: 'start' }} onClick={() => signOut()}>
              <span className="li-icon"><LogOut size={18} /></span><span className="li-main li-title">יציאה</span>
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet open={how} onClose={() => setHow(false)} title="התקנה כאפליקציה">
        <div className="sheet-body">
          <p className="muted" style={{ marginBottom: 16 }}>שלושה צעדים, פעם אחת. אחר כך הדשבורד נפתח מהאייקון במסך מלא ואפשר להפעיל בו התראות.</p>
          <InstallSteps />
        </div>
      </Sheet>

      <Sheet open={quick} onClose={() => setQuick(false)} title="הוספה מהירה">
        <div className="sheet-body">
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { label: 'הוצאה', icon: Receipt, run: () => txCrud.openNew({ kind: 'הוצאה' }) },
              { label: 'פריט לקניות', icon: ShoppingBasket, run: () => shopCrud.openNew() },
              { label: 'משימת בית', icon: ListChecks, run: () => taskCrud.openNew() },
              { label: 'אירוע ביומן', icon: CalendarDays, run: () => eventCrud.openNew() },
              { label: 'הכנסה', icon: Plus, run: () => txCrud.openNew({ kind: 'הכנסה', category: 'משכורת' }) },
            ].map((q) => (
              <button key={q.label} className="card soft clickable" style={{ gridColumn: 'span 1', textAlign: 'start', display: 'flex', flexDirection: 'column', gap: 14 }}
                onClick={() => { setQuick(false); setTimeout(q.run, 180); }}>
                <span className="li-icon" style={{ background: 'var(--surface)' }}><q.icon size={18} /></span>
                <b style={{ fontWeight: 500 }}>{q.label}</b>
              </button>
            ))}
          </div>
        </div>
      </Sheet>
      {txCrud.sheet}{taskCrud.sheet}{shopCrud.sheet}{eventCrud.sheet}
    </div>
  );
}
