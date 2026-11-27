import { useEffect, useRef, useState, type FormEvent, type ClipboardEvent, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { DEMO, DEMO_OTP } from '../lib/config';
import { DotStrip } from '../ui/charts';
import { easeOut } from '../ui/kit';

export function Login() {
  const { sendCode, verify } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState<string[]>(Array(6).fill(''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [wait, setWait] = useState(0);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) { setErr('כתובת המייל לא תקינה'); return; }
    setBusy(true); setErr('');
    try { await sendCode(email.trim().toLowerCase()); setStep('code'); setWait(30); setCode(Array(6).fill('')); setTimeout(() => refs.current[0]?.focus(), 80); }
    catch (x: any) { setErr(x.message); }
    finally { setBusy(false); }
  };

  const submit = async (digits: string[]) => {
    if (digits.some((d) => !d)) return;
    setBusy(true); setErr('');
    try { await verify(email.trim().toLowerCase(), digits.join('')); }
    catch (x: any) { setErr(x.message); setCode(Array(6).fill('')); refs.current[0]?.focus(); }
    finally { setBusy(false); }
  };

  const onDigit = (i: number, val: string) => {
    const d = val.replace(/\D/g, '');
    if (!d) { setCode((c) => c.map((x, j) => (j === i ? '' : x))); return; }
    const next = [...code];
    d.split('').slice(0, 6 - i).forEach((ch, k) => { next[i + k] = ch; });
    setCode(next);
    const focus = Math.min(5, i + d.length);
    refs.current[focus]?.focus();
    void submit(next);
  };
  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  };
  const onPaste = (e: ClipboardEvent) => {
    const d = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (d.length === 6) { e.preventDefault(); const arr = d.split(''); setCode(arr); void submit(arr); }
  };

  return (
    <div className="login">
      <div className="login-art hero" style={{ borderRadius: 'var(--r-xl)' }}>
        <div className="row" style={{ gap: 10, fontWeight: 500, fontSize: 18 }}>
          <span className="brand-mark" style={{ background: 'rgb(255 255 255 / .16)' }}><span /></span>גורזאד
        </div>
        <div style={{ marginTop: 'auto' }}>
          <DotStrip values={[2, 3, 2, 4, 3, 5, 4, 3, 5, 4, 5, 3, 4, 5, 5, 4, 3, 4, 5, 4, 5, 5]} />
          <h1 style={{ fontSize: 'clamp(26px, 3.4vw, 44px)', lineHeight: 1.12, marginTop: 20, maxWidth: '14ch' }}>הבית, העסקים והנכסים. במקום אחד.</h1>
          <p style={{ opacity: 0.85, marginTop: 12, maxWidth: '38ch' }}>משימות, כספים, חשבוניות, שוכרים והתראות — עם סוכן וואטסאפ שמעדכן ושולף בשבילך.</p>
        </div>
      </div>

      <div className="login-form">
        <div className="login-card">
          <AnimatePresence mode="wait" initial={false}>
            {step === 'email' ? (
              <motion.form key="email" onSubmit={send} className="stack" noValidate
                initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 14, transition: { duration: 0.12 } }} transition={{ duration: 0.24, ease: easeOut }}>
                <div>
                  <h2 style={{ fontSize: 28 }}>כניסה</h2>
                  <p className="muted" style={{ marginTop: 6 }}>נשלח לך קוד חד־פעמי למייל. בלי סיסמאות.</p>
                </div>
                <label className="field"><span>מייל</span>
                  <input className="input" type="email" dir="ltr" style={{ textAlign: 'right' }} autoComplete="email" inputMode="email" autoFocus placeholder="name@example.com"
                    value={email} onChange={(e) => { setEmail(e.target.value); setErr(''); }} aria-invalid={!!err || undefined} />
                  {err && <small className="neg" role="alert">{err}</small>}
                </label>
                <button className="btn btn-primary btn-block" disabled={busy}><Mail size={16} />{busy ? 'שולח…' : 'שלחו לי קוד'}</button>
                <p className="meta row" style={{ gap: 6 }}><ShieldCheck size={14} />הכניסה פתוחה רק למי שהוזמן לדשבורד.</p>
              </motion.form>
            ) : (
              <motion.div key="code" className="stack"
                initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 14, transition: { duration: 0.12 } }} transition={{ duration: 0.24, ease: easeOut }}>
                <button className="card-link" onClick={() => { setStep('email'); setErr(''); }} style={{ alignSelf: 'flex-start' }}><ArrowRight size={15} />מייל אחר</button>
                <div>
                  <h2 style={{ fontSize: 28 }}>הקוד בדרך</h2>
                  <p className="muted" style={{ marginTop: 6 }}>שלחנו קוד בן 6 ספרות אל <bdi className="ltr" style={{ color: 'var(--ink)' }}>{email}</bdi></p>
                </div>
                <motion.div className={`otp ${err ? 'err' : ''}`} onPaste={onPaste} animate={err ? { x: [0, -7, 7, -4, 4, 0] } : { x: 0 }} transition={{ duration: 0.32 }}>
                  {code.map((d, i) => (
                    <input key={i} ref={(el) => { refs.current[i] = el; }} value={d} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={6} aria-label={`ספרה ${i + 1}`}
                      onChange={(e) => onDigit(i, e.target.value)} onKeyDown={(e) => onKey(i, e)} onFocus={(e) => e.target.select()} disabled={busy} />
                  ))}
                </motion.div>
                {err && <small className="neg" role="alert">{err}</small>}
                {DEMO && <p className="badge info" style={{ alignSelf: 'flex-start', height: 'auto', padding: '6px 12px' }}>מצב הדגמה · הקוד הוא <span className="ltr" style={{ fontWeight: 700 }}>{DEMO_OTP}</span></p>}
                <button className="btn btn-ghost btn-block" disabled={wait > 0 || busy} onClick={() => send()}>
                  {wait > 0 ? <>שליחה חוזרת בעוד <span className="num ltr">{wait}</span> שנ׳</> : 'שלחו שוב'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
