import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Bell, BellOff, BellRing, Briefcase, Building2, ChevronLeft, CircleAlert, CircleCheck, Download, Home, MessageCircle, Send, Share, Smartphone, SquarePlus } from 'lucide-react';
import { alerts } from '../data/derive';
import { useDerived } from '../data/store';
import { usePrefs } from '../lib/prefs';
import { isIOS, promptInstall, useInstall } from '../lib/pwa';
import { disablePush, enablePush, loadPrefs, savePrefs, testPush, usePush } from '../lib/push';
import type { AlertArea, NotifyPrefs } from '../../shared/alerts';
import { Badge, Card, CardHead, Empty, PageHead, Stagger, Toggle } from '../ui/kit';
import { useToast } from '../ui/overlay';

const AREAS: { id: AlertArea; label: string; icon: typeof Home; tone: string }[] = [
  { id: 'home', label: 'בית', icon: Home, tone: 'var(--tone-home)' },
  { id: 'business', label: 'עסקים', icon: Briefcase, tone: 'var(--tone-business)' },
  { id: 'invest', label: 'השקעות', icon: Building2, tone: 'var(--tone-invest)' },
];

/** Steps to add the app to the home screen — needed on iPhone/iPad before notifications can be enabled. */
export function InstallSteps() {
  const inst = useInstall();
  if (inst.standalone) return null;
  if (inst.canPrompt) return <button className="btn btn-primary btn-block" onClick={() => void promptInstall()}><Download size={16} />התקנת האפליקציה</button>;
  if (!isIOS) return <p className="meta">בכרום: תפריט ⋮ ← ״התקנת האפליקציה״ או ״הוספה למסך הבית״.</p>;
  return (
    <ol className="steps">
      <li><span>פותחים את הדשבורד ב־Safari ולוחצים על <b className="row" style={{ display: 'inline-flex', gap: 4 }}><Share size={14} />שיתוף</b></span></li>
      <li><span>בוחרים <b className="row" style={{ display: 'inline-flex', gap: 4 }}><SquarePlus size={14} />הוספה למסך הבית</b></span></li>
      <li><span>פותחים את ״גורזאד״ מהאייקון החדש ומפעילים כאן התראות</span></li>
    </ol>
  );
}

export function Notifications() {
  const nav = useNavigate();
  const toast = useToast();
  const prefsUi = usePrefs();
  const list = useDerived(() => alerts(), [prefsUi.hide]);
  const [filter, setFilter] = useState<AlertArea | 'all'>('all');
  const { state, setState } = usePush();
  const [prefs, setPrefs] = useState<NotifyPrefs>(loadPrefs);
  const [busy, setBusy] = useState(false);
  const inst = useInstall();

  const shown = filter === 'all' ? list : list.filter((a) => a.area === filter);
  const urgent = list.filter((a) => a.level === 'danger').length;

  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast((e as Error).message || 'משהו השתבש'); } finally { setBusy(false); } };
  const enable = () => run(async () => {
    const s = await enablePush(prefs);
    setState(s);
    if (s === 'on') { toast('ההתראות הופעלו במכשיר הזה'); const top = list[0]; await testPush(top && { title: top.title, body: top.detail, url: top.to }).catch(() => { /* optional */ }); }
    else if (s === 'blocked') toast('ההתראות חסומות בהגדרות המכשיר');
    else if (s === 'server-off') toast('השרת עוד לא מוגדר לשליחת התראות');
  });
  const disable = () => run(async () => { await disablePush(); setState('off'); toast('ההתראות כובו במכשיר הזה'); });
  const change = (next: NotifyPrefs) => { setPrefs(next); if (state === 'on') void savePrefs(next).catch(() => toast('השמירה נכשלה')); else void savePrefs(next).catch(() => undefined); };
  const toggleArea = (id: AlertArea) => change({ ...prefs, areas: prefs.areas.includes(id) ? prefs.areas.filter((a) => a !== id) : [...prefs.areas, id] });

  const status = {
    on: { icon: BellRing, title: 'התראות פעילות במכשיר הזה', text: 'כל בוקר נשלח מה שחדש: תשלום באיחור, חוזה שמסתיים, משימה תקועה. אתר שנופל מדווח מיד.' },
    off: { icon: Bell, title: 'קבלת התראות לטלפון', text: 'התראה אמיתית על המסך הנעול, גם כשהאפליקציה סגורה.' },
    'needs-install': { icon: Smartphone, title: 'קודם מוסיפים למסך הבית', text: 'באייפון ובאייפד התראות עובדות רק מהאפליקציה המותקנת.' },
    blocked: { icon: BellOff, title: 'ההתראות חסומות', text: 'פותחים את הגדרות המכשיר ← התראות ← גורזאד ומאשרים, ואז חוזרים לכאן.' },
    unsupported: { icon: BellOff, title: 'הדפדפן הזה לא תומך בהתראות', text: 'אפשר להפעיל התראות מהטלפון או מכרום / Safari עדכני.' },
    'server-off': { icon: BellOff, title: 'השרת עוד לא מוגדר', text: 'חסרים מפתחות ההתראות (VAPID) בהגדרות השרת.' },
  }[state ?? 'off'];
  const SIcon = status.icon;

  return (
    <>
      <PageHead tag="מערכת" tone="var(--ink-2)" title="התראות" sub={list.length ? `${list.length} פתוחות${urgent ? ` · ${urgent} דחופות` : ''}` : 'אין שום דבר שמחכה לך'} />
      <Stagger>
        <Card className="flush lg-7 md-12">
          <div style={{ padding: '16px 16px 4px' }}>
            <div className="chips" role="group" aria-label="סינון לפי תחום">
              <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>הכול<span className="count num">{list.length}</span></button>
              {AREAS.map((a) => {
                const n = list.filter((x) => x.area === a.id).length;
                return <button key={a.id} className="chip" aria-pressed={filter === a.id} onClick={() => setFilter(a.id)}><a.icon size={14} />{a.label}<span className="count num">{n}</span></button>;
              })}
            </div>
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
                  <span className="li-end">{a.level === 'danger' && <span className="hide-sm"><Badge kind="neg" icon={false}>דחוף</Badge></span>}<ChevronLeft size={16} className="muted" /></span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <div className="stack lg-5 md-12">
          <Card>
            <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
              <span className="li-icon" style={{ background: state === 'on' ? 'var(--lime)' : 'var(--surface-2)', color: state === 'on' ? 'var(--on-lime)' : 'var(--ink)', flexShrink: 0 }}><SIcon size={18} /></span>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: 19 }}>{status.title}</h2>
                <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>{status.text}</p>
              </div>
            </div>
            <div className="stack" style={{ gap: 10, marginTop: 16 }}>
              {state === 'needs-install' && <InstallSteps />}
              {(state === 'off' || state === 'server-off') && <button className="btn btn-primary btn-block" disabled={busy} onClick={enable}><BellRing size={16} />הפעלת התראות</button>}
              {state === 'on' && (
                <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <button className="btn btn-soft" style={{ flex: 1 }} disabled={busy} onClick={() => run(async () => { await testPush(); toast('נשלחה התראת בדיקה'); })}><Send size={15} />התראת בדיקה</button>
                  <button className="btn btn-ghost" disabled={busy} onClick={disable}>כיבוי</button>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHead title="על מה להתריע" sub="נשמר למכשיר הזה" />
            <div className="stack" style={{ gap: 8 }}>
              {AREAS.map((a) => (
                <label key={a.id} className="switch"><span className="row"><a.icon size={16} style={{ color: a.tone }} />{a.label}</span><Toggle checked={prefs.areas.includes(a.id)} onChange={() => toggleArea(a.id)} label={a.label} /></label>
              ))}
              <label className="switch"><span className="row"><CircleAlert size={16} />רק דחופות</span><Toggle checked={prefs.urgentOnly} onChange={(v) => change({ ...prefs, urgentOnly: v })} label="רק דחופות" /></label>
            </div>
            <p className="meta" style={{ marginTop: 12 }}>הספים של התראות הנכסים (ימי איחור, סיום חוזה) נקבעים ב<button className="link" onClick={() => nav('/invest/alerts')}>חוקי ההתראה</button>.</p>
          </Card>

          {!inst.standalone && state !== 'needs-install' && (
            <Card className="soft">
              <CardHead title="האפליקציה במסך הבית" sub="נפתחת במסך מלא, בלי שורת כתובת, עם מספר ההתראות על האייקון" />
              <InstallSteps />
            </Card>
          )}

          <Card className="soft" to="/whatsapp">
            <div className="row"><span className="li-icon" style={{ background: 'var(--surface)' }}><MessageCircle size={18} /></span><div className="li-main"><div className="li-title">גם בוואטסאפ</div><div className="li-meta">שואלים את הסוכן ״מה קרוב?״ ומקבלים את אותה רשימה</div></div><ChevronLeft size={16} className="muted" /></div>
          </Card>
        </div>
      </Stagger>
    </>
  );
}
