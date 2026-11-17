import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, BellRing, Bot, Check, Clock, Eye, EyeOff, Globe, KeyRound, Mail, MessageCircle, Moon, Plus, RefreshCw, RotateCcw, ScanLine, Send, Server, ShieldCheck, Sun, Trash2, UserPlus, Users, Webhook } from 'lucide-react';
import { ruleBasedReply } from '../../shared/agent';
import type { Area, Rec, Role } from '../data/types';
import { resetDemo, store, useCollection } from '../data/store';
import { useAuth } from '../auth/AuthProvider';
import { DEMO } from '../lib/config';
import { supabase } from '../lib/supabase';
import { clock, shortDate, today } from '../lib/format';
import { isDark, setPrefs, usePrefs } from '../lib/prefs';
import { AddButton, useCrud } from '../ui/crud';
import { Badge, Card, CardHead, Empty, Kpi, PageHead, Stagger, Toggle, easeOut } from '../ui/kit';
import { Sheet, useToast } from '../ui/overlay';

/* ---------- server config probe ---------- */
type Health = { supabase: boolean; mail?: boolean; push?: boolean; cron?: boolean; gemini: boolean; kapso: boolean; kapso_webhook: boolean; allowed_numbers: number } | null;
function useHealth() {
  const [h, setH] = useState<Health | undefined>(undefined);
  useEffect(() => {
    let on = true;
    fetch('/api/health').then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null)).then((j) => on && setH(j)).catch(() => on && setH(null));
    return () => { on = false; };
  }, []);
  return h;
}
const conn = (ok?: boolean) => ok ? <Badge kind="pos">מחובר</Badge> : <Badge>לא מחובר</Badge>;

/* ================= WhatsApp ================= */
export function WhatsApp() {
  const msgs = useCollection('wa_messages');
  const health = useHealth();
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const sorted = [...msgs].sort((a, b) => a.at.localeCompare(b.at));

  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }); }, [msgs.length, typing]);

  const send = async (e?: FormEvent, preset?: string) => {
    e?.preventDefault();
    const t = (preset ?? text).trim();
    if (!t || typing) return;
    setText('');
    store.add('wa_messages', { direction: 'in', text: t, at: new Date().toISOString(), sandbox: true });
    setTyping(true);
    // The sandbox runs the same agent core as the webhook, against the data on screen.
    const reply = await ruleBasedReply(t, { all: (c) => store.all(c as any), add: (c, d) => store.add(c as any, d), update: (c, id, p) => store.update(c as any, id, p) });
    setTimeout(() => { store.add('wa_messages', { direction: 'out', text: reply, at: new Date().toISOString(), sandbox: true }); setTyping(false); }, 450);
  };

  const can = [
    ['להזין', 'קניות, משימות (בית / עסק / נכס), הוצאות, סימון שכירות ששולמה'],
    ['לשלוף', 'רשימת קניות, משימות פתוחות, הוצאות ותקציב, מצב כספי של עסק, מי שילם שכירות, מה קרוב'],
    ['בהמשך', 'צילום קבלה → הוצאה אוטומטית (Gemini), התראות יזומות על נכסים'],
  ];

  return (
    <>
      <PageHead tag="סוכן" tone="var(--ink-2)" title="וואטסאפ" sub="כותבים לסוכן בוואטסאפ, והוא מזין ושולף מהמערכת." />
      <Stagger>
        <Card className="flush lg-7 md-12">
          <div className="card-head" style={{ padding: '16px 20px', marginBottom: 0, borderBottom: '1px solid var(--line)' }}>
            <div className="row"><span className="avatar"><Bot size={18} /></span><div><h2>ארגז חול</h2><div className="sub">אותו סוכן, בלי וואטסאפ. משנה נתונים אמיתיים בדשבורד.</div></div></div>
          </div>
          <div className="chat" ref={box} aria-live="polite">
            <AnimatePresence initial={false}>
              {sorted.map((m) => (
                <motion.div key={m.id} className={`bubble ${m.direction === 'in' ? 'out' : 'in'}`} initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.22, ease: easeOut }} style={{ transformOrigin: m.direction === 'in' ? 'bottom left' : 'bottom right' }}>
                  <bdi>{m.text}</bdi><time>{shortDate(m.at.slice(0, 10))} · {clock(m.at)}</time>
                </motion.div>
              ))}
              {typing && <motion.div key="typing" className="bubble in muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>מקליד…</motion.div>}
            </AnimatePresence>
          </div>
          <div className="chips" style={{ padding: '10px 12px 0' }}>
            {['תוסיף לקניות קפה, בננות', 'הוצאה 85 פיצה', 'כמה הוצאנו החודש?', 'מי שילם שכירות?', 'מה המצב בספא?'].map((s) => <button key={s} className="chip" onClick={() => send(undefined, s)}>{s}</button>)}
          </div>
          <form className="chat-input" onSubmit={send}>
            <input className="input" dir="auto" placeholder="כתוב הודעה כמו בוואטסאפ…" value={text} onChange={(e) => setText(e.target.value)} aria-label="הודעה" enterKeyHint="send" />
            <button className="btn btn-primary" style={{ width: 48, padding: 0, height: 48 }} aria-label="שליחה" disabled={!text.trim()}><Send size={18} style={{ transform: 'scaleX(-1)' }} /></button>
          </form>
        </Card>

        <div className="stack lg-5 md-12">
          <Card>
            <CardHead title="חיבור Kapso">{health === undefined ? <span className="meta">בודק…</span> : conn(health?.kapso && health?.kapso_webhook)}</CardHead>
            <div className="list no-top inset">
              <div className="li"><span className="li-icon"><KeyRound size={18} /></span><div className="li-main"><div className="li-title">מפתח API ומספר</div><div className="li-meta ltr">KAPSO_API_KEY · KAPSO_PHONE_NUMBER_ID</div></div>{conn(health?.kapso)}</div>
              <div className="li"><span className="li-icon"><Webhook size={18} /></span><div className="li-main"><div className="li-title">Webhook נכנס</div><div className="li-meta ltr">/api/whatsapp-webhook</div></div>{conn(health?.kapso_webhook)}</div>
              <div className="li"><span className="li-icon"><ShieldCheck size={18} /></span><div className="li-main"><div className="li-title">מספרים מורשים</div><div className="li-meta">רק מספרים ברשימה יכולים לדבר עם הסוכן</div></div><Badge>{health?.allowed_numbers ?? 0}</Badge></div>
              <div className="li"><span className="li-icon"><Bot size={18} /></span><div className="li-main"><div className="li-title">מוח הסוכן (Gemini)</div><div className="li-meta">בלי מפתח הסוכן עובד לפי פקודות קבועות</div></div>{conn(health?.gemini)}</div>
            </div>
          </Card>
          <Card className="soft">
            <CardHead title="מה הסוכן יודע לעשות" />
            <dl className="kv" style={{ gridTemplateColumns: '64px 1fr' }}>
              {can.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd style={{ textAlign: 'start', fontWeight: 400 }}>{v}</dd></div>)}
            </dl>
          </Card>
        </div>
      </Stagger>
    </>
  );
}

/* ================= Status ================= */
type Probe = { ok: boolean; ms: number } | 'checking' | undefined;

async function probe(url: string): Promise<{ ok: boolean; ms: number }> {
  const t0 = performance.now();
  if (!DEMO) {
    try {
      // Server-side check when deployed (real status code, no CORS limits).
      const { data } = await supabase!.auth.getSession();
      const r = await fetch(`/api/status-check?url=${encodeURIComponent(url)}`, { headers: { authorization: `Bearer ${data.session?.access_token}` } });
      if (r.ok && r.headers.get('content-type')?.includes('json')) return await r.json();
    } catch { /* fall through to the browser check */ }
  }
  try { await fetch(url, { mode: 'no-cors', cache: 'no-store' }); return { ok: true, ms: Math.round(performance.now() - t0) }; }
  catch { return { ok: false, ms: Math.round(performance.now() - t0) }; }
}

export function Status() {
  const monitors = useCollection('monitors');
  const crud = useCrud('monitors');
  const [live, setLive] = useState<Record<string, Probe>>({});
  const [last, setLast] = useState<Date | null>(null);

  const run = async () => {
    const targets = monitors.filter((m) => m.url);
    setLive((l) => ({ ...l, ...Object.fromEntries(targets.map((m) => [m.id, 'checking' as const])) }));
    await Promise.all(targets.map(async (m) => {
      const res = await probe(m.url);
      setLive((l) => ({ ...l, [m.id]: res }));
      const hist = [...(m.history ?? []).filter((h: any) => h.day !== today()), { day: today(), ok: res.ok, ms: res.ms }].slice(-30);
      store.update('monitors', m.id, { history: hist });
    }));
    setLast(new Date());
  };
  useEffect(() => { void run(); /* on mount only */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const withUrl = monitors.filter((m) => m.url);
  const down = withUrl.filter((m) => { const p = live[m.id]; return p && p !== 'checking' && !p.ok; });
  const pending = monitors.length - withUrl.length;

  return (
    <>
      <PageHead tag="ניטור" tone="var(--ink-2)" title="סטטוס אתרים ומערכות" sub={last ? `נבדק לאחרונה ב־${clock(last.toISOString())}` : 'בודק…'}>
        <button className="btn btn-ghost" onClick={run}><RefreshCw size={15} />בדיקה עכשיו</button>
        <AddButton label="בדיקה חדשה" onClick={() => crud.openNew()} />
      </PageHead>
      <Stagger>
        <Card className={`lg-4 md-12 ${down.length ? '' : 'hero dark'}`} style={down.length ? { background: 'var(--neg-bg)', borderColor: 'transparent' } : { minHeight: 0 }}>
          <div className="row"><span className={`pulse ${down.length ? 'bad' : ''}`} style={down.length ? undefined : { background: 'var(--lime)' }} /><b style={{ fontWeight: 500, fontSize: 18 }}>{down.length ? `${down.length} מערכות לא זמינות` : 'כל המערכות פעילות'}</b></div>
          <p style={{ opacity: 0.8, marginTop: 8, fontSize: 13 }}>{withUrl.length} בדיקות פעילות{pending ? ` · ${pending} מחכות לכתובת` : ''}</p>
        </Card>
        <Card className="soft lg-8 md-12">
          <CardHead title="שיקוף נתונים מהאתרים" sub="השלב הבא" />
          <p className="muted" style={{ fontSize: 14 }}>כרגע המסך בודק זמינות וזמן תגובה. כשנחבר את האתר של עדן ואת אתר הספא, כל כרטיס יציג גם נתונים מהאתר עצמו (הזמנות, לידים, תנועה). כדי להפעיל בדיקה לאתר, לחץ עליו והוסף כתובת.</p>
        </Card>

        {monitors.map((m) => {
          const p = live[m.id];
          const hist: { day: string; ok: boolean; ms: number }[] = m.history ?? [];
          const up = hist.length ? hist.filter((h) => h.ok).length / hist.length : null;
          const Icon = m.kind === 'אתר' ? Globe : m.kind === 'API' ? Webhook : Server;
          return (
            <Card key={m.id} className="lg-4 md-6" onClick={() => crud.openEdit(m)}>
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <div className="row" style={{ minWidth: 0 }}><span className="li-icon"><Icon size={18} /></span><div style={{ minWidth: 0 }}><b style={{ fontWeight: 500, display: 'block' }}>{m.name}</b><span className="meta">{m.owner || m.kind}</span></div></div>
                {!m.url ? <Badge>חסרה כתובת</Badge> : p === 'checking' || !p ? <Badge>בודק…</Badge> : p.ok ? <Badge kind="pos">פעיל</Badge> : <Badge kind="neg">לא זמין</Badge>}
              </div>
              <div className="uptime" style={{ marginTop: 16 }} role="img" aria-label={up != null ? `זמינות ${Math.round(up * 100)}% ב־30 הימים האחרונים` : 'אין היסטוריה'}>
                {Array.from({ length: 30 }, (_, i) => { const h = hist[hist.length - 30 + i]; return <i key={i} className={!h ? 'none' : h.ok ? '' : 'bad'} />; })}
              </div>
              <div className="spread meta" style={{ marginTop: 8 }}>
                <span>{up != null ? `זמינות ${(up * 100).toFixed(up === 1 ? 0 : 1)}%` : 'אין נתונים עדיין'}</span>
                {p && p !== 'checking' && <span className="row" style={{ gap: 4 }}><Clock size={12} /><span className="ltr num">{p.ms}ms</span></span>}
              </div>
            </Card>
          );
        })}
        {monitors.length === 0 && <Card className="lg-12"><Empty icon={Activity} title="אין בדיקות" text="הוסף אתר או מערכת כדי לראות אם הם באוויר." /></Card>}
      </Stagger>
      {crud.sheet}
    </>
  );
}

/* ================= Team ================= */
const ROLE: Record<Role, string> = { owner: 'בעלים', editor: 'עורך', viewer: 'צופה' };
const AREAS: [Area, string][] = [['home', 'בית'], ['business', 'עסקים'], ['invest', 'השקעות']];

export function Team() {
  const members = useCollection('members');
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [areas, setAreas] = useState<Area[]>(['home']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    const mail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(mail)) { setErr('כתובת המייל לא תקינה'); return; }
    if (members.some((m) => m.email === mail)) { setErr('המייל הזה כבר ברשימה'); return; }
    if (!areas.length) { setErr('בחר לפחות תחום אחד'); return; }
    setBusy(true); setErr('');
    try {
      if (!DEMO) {
        const { data } = await supabase!.auth.getSession();
        const r = await fetch('/api/invite', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token}` }, body: JSON.stringify({ email: mail, name, role, areas }) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'שליחת ההזמנה נכשלה');
      }
      store.add('members', { email: mail, name: name || mail.split('@')[0], role, areas, status: 'invited', invited_at: today() });
      toast(DEMO ? 'ההזמנה נרשמה (במצב הדגמה לא נשלח מייל)' : `הזמנה נשלחה אל ${mail}`);
      setOpen(false); setEmail(''); setName('');
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHead tag="שיתוף" tone="var(--ink-2)" title="צוות ושיתוף" sub="מזמינים במייל. כל אחד רואה רק את התחומים שפתחת לו."><button className="btn btn-primary" onClick={() => setOpen(true)}><UserPlus size={16} />הזמנה במייל</button></PageHead>
      <Stagger>
        <Card className="flush lg-8 md-12">
          <div className="list">
            {members.map((m: Rec) => (
              <div key={m.id} className="li">
                <span className="avatar">{(m.name || m.email).slice(0, 1)}</span>
                <div className="li-main"><div className="li-title">{m.name}{m.email === user?.email || m.role === 'owner' ? '' : ''}</div><div className="li-meta"><span className="ltr">{m.email}</span></div>
                  <div className="chips" style={{ marginTop: 6 }}>{AREAS.filter(([a]) => m.areas?.includes(a)).map(([a, l]) => <span key={a} className="badge">{l}</span>)}</div></div>
                <div className="li-end">
                  {m.status === 'invited' ? <Badge kind="warn">הזמנה ממתינה</Badge> : <Badge kind={m.role === 'owner' ? 'info' : 'none'} icon={false}>{ROLE[m.role as Role]}</Badge>}
                  {m.role !== 'owner' && <button className="icon-btn bare" aria-label={`הסרת ${m.name}`} onClick={() => { const undo = store.remove('members', m.id); toast('הגישה הוסרה', undo); }}><Trash2 size={15} /></button>}
                </div>
              </div>
            ))}
          </div>
          {members.length <= 1 && <Empty icon={Users} title="רק אתה כאן בינתיים" text="הזמן בן/בת זוג לניהול הבית, רואה חשבון לעסקים או מנהל נכסים להשקעות." />}
        </Card>
        <Card className="soft lg-4 md-12" style={{ alignSelf: 'start' }}>
          <CardHead title="הרשאות" />
          <dl className="kv" style={{ gridTemplateColumns: '56px 1fr' }}>
            <dt>בעלים</dt><dd style={{ textAlign: 'start', fontWeight: 400 }}>הכול, כולל הזמנות והגדרות</dd>
            <dt>עורך</dt><dd style={{ textAlign: 'start', fontWeight: 400 }}>הוספה ועריכה בתחומים שנפתחו לו</dd>
            <dt>צופה</dt><dd style={{ textAlign: 'start', fontWeight: 400 }}>קריאה בלבד</dd>
          </dl>
          <p className="meta" style={{ marginTop: 14 }}>המוזמן מקבל מייל עם קישור, ונכנס עם קוד חד־פעמי למייל. בלי סיסמאות.</p>
        </Card>
      </Stagger>

      <Sheet open={open} onClose={() => setOpen(false)} title="הזמנה לדשבורד">
        <form onSubmit={invite} style={{ display: 'contents' }} noValidate>
          <div className="sheet-body">
            <div className="form">
              <label className="field full"><span>מייל</span><input className="input" type="email" dir="ltr" style={{ textAlign: 'right' }} value={email} onChange={(e) => { setEmail(e.target.value); setErr(''); }} placeholder="name@example.com" /></label>
              <label className="field full"><span>שם</span><input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} /></label>
              <div className="field full"><span>תפקיד</span><div className="chips">{(['editor', 'viewer'] as Role[]).map((r) => <button type="button" key={r} className="chip" aria-pressed={role === r} onClick={() => setRole(r)}>{ROLE[r]}</button>)}</div></div>
              <div className="field full"><span>גישה לתחומים</span><div className="chips">{AREAS.map(([a, l]) => <button type="button" key={a} className="chip" aria-pressed={areas.includes(a)} onClick={() => setAreas((x) => (x.includes(a) ? x.filter((y) => y !== a) : [...x, a]))}>{areas.includes(a) && <Check size={14} />}{l}</button>)}</div></div>
              {err && <small className="neg full" role="alert">{err}</small>}
            </div>
          </div>
          <div className="sheet-foot"><span className="grow" /><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>ביטול</button><button className="btn btn-primary" disabled={busy}><Mail size={16} />{busy ? 'שולח…' : 'שליחת הזמנה'}</button></div>
        </form>
      </Sheet>
    </>
  );
}

/* ================= Settings ================= */
export function SettingsPage() {
  const prefs = usePrefs();
  const health = useHealth();
  const toast = useToast();
  const dark = isDark();
  const rows = [
    { icon: Server, name: 'Supabase', desc: 'בסיס נתונים, משתמשים והרשאות, אחסון תמונות (טבלאות gd_*)', env: 'VITE_SUPABASE_URL · VITE_SUPABASE_ANON_KEY · SUPABASE_SERVICE_ROLE_KEY', ok: !DEMO },
    { icon: Mail, name: 'Resend', desc: 'שליחת קוד הכניסה (OTP) והזמנות במייל', env: 'RESEND_API_KEY · MAIL_FROM · OWNER_EMAIL', ok: !!health?.mail },
    { icon: MessageCircle, name: 'Kapso · WhatsApp', desc: 'קבלה ושליחה של הודעות וואטסאפ לסוכן', env: 'KAPSO_API_KEY · KAPSO_PHONE_NUMBER_ID · KAPSO_WEBHOOK_SECRET', ok: !!health?.kapso },
    { icon: BellRing, name: 'התראות פוש', desc: 'התראות לטלפון מהאפליקציה המותקנת, כל בוקר ובזמן אמת כשאתר נופל', env: 'VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY · CRON_SECRET', ok: !!health?.push && !!health?.cron },
    { icon: ScanLine, name: 'Gemini', desc: 'הבנת שפה חופשית לסוכן, ובהמשך סריקת קבלות', env: 'GEMINI_API_KEY', ok: !!health?.gemini },
    { icon: Plus, name: 'מערכת חשבוניות', desc: 'משיכת חשבוניות לכל עסק. נבחר ספק בהמשך', env: 'api/sync-invoices.ts', ok: false },
  ];
  return (
    <>
      <PageHead tag="מערכת" tone="var(--ink-2)" title="הגדרות וחיבורים" />
      <Stagger>
        <Card className="flush lg-8 md-12">
          <div className="card-head" style={{ padding: '20px 20px 4px', marginBottom: 0 }}><div><h2>חיבורים</h2><div className="sub">מפתחות מוגדרים כמשתני סביבה בשרת (Vercel), לא נשמרים בדפדפן</div></div></div>
          <div className="list">
            {rows.map((r) => (
              <div key={r.name} className="li" style={{ alignItems: 'flex-start', paddingBlock: 14 }}>
                <span className="li-icon"><r.icon size={18} /></span>
                <div className="li-main"><div className="li-title">{r.name}</div><div className="li-meta">{r.desc}</div><div className="meta ltr" style={{ marginTop: 4, textAlign: 'right', wordBreak: 'break-word' }}>{r.env}</div></div>
                {conn(r.ok)}
              </div>
            ))}
          </div>
        </Card>
        <div className="stack lg-4 md-12">
          <Card>
            <CardHead title="תצוגה" />
            <div className="stack" style={{ gap: 10 }}>
              <label className="switch"><span className="row">{dark ? <Moon size={16} /> : <Sun size={16} />}מצב כהה</span><Toggle checked={dark} onChange={(v) => setPrefs({ theme: v ? 'dark' : 'light' })} label="מצב כהה" /></label>
              <label className="switch"><span className="row">{prefs.hide ? <EyeOff size={16} /> : <Eye size={16} />}הסתרת סכומים</span><Toggle checked={prefs.hide} onChange={(v) => setPrefs({ hide: v })} label="הסתרת סכומים" /></label>
            </div>
          </Card>
          {DEMO && (
            <Card className="soft">
              <Kpi label="מצב הדגמה" value={<span style={{ fontSize: 18 }}>נתוני דוגמה בדפדפן הזה</span>} />
              <p className="meta" style={{ marginBlock: 10 }}>כל שינוי נשמר מקומית בלבד. אחרי חיבור Supabase הנתונים עוברים לענן ומשותפים לכל המוזמנים.</p>
              <button className="btn btn-ghost btn-sm" onClick={() => { resetDemo(); toast('נתוני הדוגמה אופסו'); }}><RotateCcw size={14} />איפוס נתוני הדוגמה</button>
            </Card>
          )}
        </div>
      </Stagger>
    </>
  );
}
