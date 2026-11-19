import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X, Trash2 } from 'lucide-react';
import type { FieldDef } from '../data/types';
import { useCollection } from '../data/store';
import { easeOut } from './kit';

/* ================= Toasts ================= */
type Toast = { id: number; text: string; undo?: () => void };
const ToastCtx = createContext<(text: string, undo?: () => void) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, undo?: () => void) => {
    const id = ++seq.current;
    setItems((x) => [...x.slice(-2), { id, text, undo }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), undo ? 5500 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div key={t.id} layout className="toast"
              initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.14 } }}
              transition={{ duration: 0.26, ease: easeOut }}>
              <span>{t.text}</span>
              {t.undo && <button onClick={() => { t.undo!(); setItems((x) => x.filter((i) => i.id !== t.id)); }}>בטל</button>}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/* ================= Sheet ================= */
function useIsMobile() {
  const q = '(max-width: 767px)';
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return m;
}

export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const mobile = useIsMobile();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // focus first field (not on touch — avoids the keyboard jumping up before the sheet settles)
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>(mobile ? '[data-close]' : 'input, select, textarea');
      el?.focus({ preventScroll: true });
    }, 60);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; clearTimeout(t); restore.current?.focus?.(); };
  }, [open, onClose, mobile]);

  // RTL: desktop drawer sits on the left edge (inline-start is right in RTL → we use inline-start = "start" side visually left via CSS inset-inline-start in LTR terms)
  const from = reduce ? { opacity: 0 } : mobile ? { y: '100%' } : { x: '-104%' };
  const to = reduce ? { opacity: 1 } : mobile ? { y: 0 } : { x: 0 };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.16 } }} transition={{ duration: 0.22 }} />
          <motion.div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={title}
            style={mobile ? undefined : { insetInlineStart: 'auto', left: 12 }}
            initial={from} animate={to} exit={{ ...from, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            transition={{ duration: mobile ? 0.42 : 0.34, ease: [0.32, 0.72, 0, 1] }}
            drag={mobile && !reduce ? 'y' : false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_e, info) => { if (info.offset.y > 120 || info.velocity.y > 500) onClose(); }}>
            <div className="sheet-head">
              <h2>{title}</h2>
              <button className="icon-btn" data-close onClick={onClose} aria-label="סגירה"><X size={18} /></button>
            </div>
            {children}
            {footer}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ================= Record form ================= */
export function defaultsFor(fields: FieldDef[]) {
  const out: Record<string, any> = {};
  fields.forEach((f) => {
    const d = typeof f.default === 'function' ? f.default() : f.default;
    out[f.key] = d ?? (f.type === 'bool' ? false : '');
  });
  return out;
}

export function RecordSheet({ open, onClose, title, fields, initial, onSave, onDelete }: {
  open: boolean; onClose: () => void; title: string; fields: FieldDef[];
  initial?: Record<string, any> | null; onSave: (data: Record<string, any>) => void; onDelete?: () => void;
}) {
  const [v, setV] = useState<Record<string, any>>({});
  const [tried, setTried] = useState(false);
  const members = useCollection('members');
  useEffect(() => { if (open) { setV({ ...defaultsFor(fields), ...(initial ?? {}) }); setTried(false); } }, [open, initial, fields]);

  const set = (k: string, val: any) => setV((x) => ({ ...x, [k]: val }));
  const missing = (f: FieldDef) => f.required && (v[f.key] === '' || v[f.key] == null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (fields.some(missing)) return;
    const out: Record<string, any> = {};
    fields.forEach((f) => {
      out[f.key] = f.type === 'money' || f.type === 'number' ? (v[f.key] === '' ? null : Number(v[f.key])) : v[f.key];
      // a member field also stores the address the reminders go to
      if (f.type === 'member') out[`${f.key}_email`] = members.find((m) => m.name === v[f.key])?.email ?? '';
    });
    onSave(out);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} style={{ display: 'contents' }} noValidate>
        <div className="sheet-body">
          <div className="form">
            {fields.map((f) => {
              const bad = tried && missing(f);
              const common = { id: `f-${f.key}`, 'aria-invalid': bad || undefined, placeholder: f.placeholder, value: v[f.key] ?? '', onChange: (e: any) => set(f.key, e.target.value) };
              if (f.type === 'bool') return (
                <label key={f.key} className="switch full">
                  <span>{f.label}</span>
                  <button type="button" className="toggle" role="switch" aria-checked={!!v[f.key]} aria-label={f.label} onClick={() => set(f.key, !v[f.key])} />
                </label>
              );
              return (
                <label key={f.key} className={`field ${f.half ? '' : 'full'}`} htmlFor={`f-${f.key}`}>
                  <span>{f.label}{f.required && <span className="neg" aria-hidden> *</span>}</span>
                  {f.type === 'select' ? (
                    <select className="select" {...common}>{!f.required && !f.default && <option value="">—</option>}{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
                  ) : f.type === 'member' ? (
                    <select className="select" {...common}>
                      <option value="">ללא</option>
                      {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                      {v[f.key] && !members.some((m) => m.name === v[f.key]) && <option value={v[f.key]}>{v[f.key]}</option>}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea className="textarea" dir="auto" {...common} />
                  ) : f.type === 'money' ? (
                    <div className="money-input"><input className="input num" type="number" inputMode="decimal" min="0" step="any" dir="ltr" style={{ textAlign: 'right' }} {...common} /></div>
                  ) : (
                    <input className="input" dir={['date', 'time', 'month', 'number', 'email', 'tel', 'url'].includes(f.type) ? 'ltr' : 'auto'} style={['email', 'tel', 'url', 'number'].includes(f.type) ? { textAlign: 'right' } : undefined}
                      type={f.type === 'text' ? 'text' : f.type} inputMode={f.type === 'number' ? 'numeric' : undefined} {...common} />
                  )}
                  {bad ? <small className="neg">שדה חובה</small> : f.hint && <small>{f.hint}</small>}
                </label>
              );
            })}
          </div>
        </div>
        <div className="sheet-foot">
          {onDelete && <button type="button" className="btn btn-danger" onClick={() => { onDelete(); onClose(); }} aria-label="מחיקה"><Trash2 size={16} /><span className="hide-sm">מחיקה</span></button>}
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button type="submit" className="btn btn-primary">שמירה</button>
        </div>
      </form>
    </Sheet>
  );
}
