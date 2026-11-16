import { type ReactNode, type CSSProperties, createContext, useContext, useEffect, useId, useRef } from 'react';
import { motion } from 'motion/react';
import { ArrowDownRight, ArrowUpRight, Check, Minus, AlertTriangle, CircleAlert, CircleCheck, Info, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

export const spring = { type: 'spring', stiffness: 420, damping: 34 } as const;
export const easeOut = [0.22, 1, 0.36, 1] as const;

/* ---------- Page scaffolding ---------- */
export function PageHead({ tag, tone, title, sub, children }: { tag?: string; tone?: string; title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {tag && <div className="area-tag" style={{ '--tone': tone } as CSSProperties}>{tag}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  );
}

/* Entrance choreography.
   - First paint of a page: cards rise in a 40ms cascade (seen a few times a day → may carry some delight).
   - Switching sub-tabs / businesses: seen tens of times a day → a 140ms cross-fade only, no movement, no cascade. */
const QuickCtx = createContext(false);
export function TabBody({ id, children }: { id: string; children: ReactNode }) {
  const first = useRef(id);
  const quick = first.current !== id;
  if (quick) first.current = '';
  return <QuickCtx.Provider value={quick}><div key={id} style={{ display: 'contents' }}>{children}</div></QuickCtx.Provider>;
}
export function Stagger({ children, className = 'grid' }: { children: ReactNode; className?: string }) {
  const quick = useContext(QuickCtx);
  return (
    <motion.div className={className} initial="hidden" animate={quick ? 'quick' : 'show'}
      variants={{ show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } }, quick: {} }}>
      {children}
    </motion.div>
  );
}
export const rise = {
  hidden: { opacity: 0, y: 10, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.32, ease: easeOut } },
  quick: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.14, ease: 'easeOut' as const, y: { duration: 0 }, scale: { duration: 0 } } },
};
const MotionLink = motion.create(Link);
export function Card({ children, className = '', style, onClick, to }: { children: ReactNode; className?: string; style?: CSSProperties; onClick?: () => void; to?: string }) {
  const cls = `card ${className} ${onClick || to ? 'clickable' : ''}`;
  if (to) return <MotionLink to={to} variants={rise} className={cls} style={{ color: 'inherit', display: 'block', ...style }}>{children}</MotionLink>;
  return <motion.section variants={rise} className={cls} style={style} onClick={onClick}>{children}</motion.section>;
}
export function CardHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="card-head">
      <div><h2>{title}</h2>{sub && <div className="sub">{sub}</div>}</div>
      {children}
    </div>
  );
}

/* ---------- Pill nav with sliding indicator ---------- */
export function PillTabs<T extends string>({ items, value, onChange, id }: { items: { value: T; label: string; icon?: LucideIcon; count?: number }[]; value: T; onChange: (v: T) => void; id?: string }) {
  const auto = useId();
  const lid = id ?? auto;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [value]);
  return (
    <div className="pill-nav" role="tablist" ref={ref}>
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button key={it.value} role="tab" aria-selected={on} className="pill" onClick={() => onChange(it.value)}>
            {on && <motion.span layoutId={`pill-${lid}`} className="pill-bg" transition={spring} />}
            {it.icon && <it.icon size={16} />}
            <span>{it.label}</span>
            {it.count != null && it.count > 0 && <span className="count" style={{ opacity: 0.7, fontSize: 12 }}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- KPI ---------- */
export function Delta({ value, invert, suffix = '' }: { value: number | null; invert?: boolean; suffix?: string }) {
  if (value == null || !Number.isFinite(value)) return null;
  const pct = Math.round(value * 100);
  const dir = pct === 0 ? 'flat' : (pct > 0) !== !!invert ? 'up' : 'down';
  const Icon = pct === 0 ? Minus : pct > 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={`delta ${dir}`}><Icon size={13} /><span className="ltr">{Math.abs(pct)}%</span>{suffix}</span>;
}
export function Kpi({ label, value, icon: Icon, foot, delta, invert, tone }: { label: string; value: ReactNode; icon?: LucideIcon; foot?: ReactNode; delta?: number | null; invert?: boolean; tone?: string }) {
  return (
    <div className="kpi" style={{ '--tone': tone } as CSSProperties}>
      <div className="kpi-label">{Icon && <span className="kpi-icon"><Icon size={17} /></span>}{label}</div>
      <div className="kpi-value">{value}</div>
      {(foot || delta != null) && <div className="kpi-foot"><Delta value={delta ?? null} invert={invert} />{foot}</div>}
    </div>
  );
}

/* ---------- Badge ---------- */
const badgeIcon = { pos: CircleCheck, warn: AlertTriangle, neg: CircleAlert, info: Info, none: null } as const;
export function Badge({ kind = 'none', children, icon = true }: { kind?: 'pos' | 'warn' | 'neg' | 'info' | 'none'; children: ReactNode; icon?: boolean }) {
  const I = badgeIcon[kind];
  return <span className={`badge ${kind === 'none' ? '' : kind}`}>{icon && I && <I size={13} />}{children}</span>;
}

/* ---------- Meter ---------- */
export function Meter({ value, max, tone, small }: { value: number; max: number; tone?: string; small?: boolean }) {
  const ratio = max > 0 ? value / max : 0;
  return (
    <div className={`meter ${ratio > 1 ? 'over' : ''} ${small ? 'sm' : ''}`} role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100} style={{ '--tone': tone } as CSSProperties}>
      <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: Math.min(1, ratio) }} transition={{ duration: 0.5, ease: easeOut, delay: 0.08 }} style={{ width: '100%' }} />
    </div>
  );
}

/* ---------- Checkbox ---------- */
export function CheckBox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button className="check" role="checkbox" aria-checked={checked} aria-label={label} onClick={(e) => { e.stopPropagation(); onChange(!checked); }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 7.5 5.5 10.5 11.5 3.5" /></svg>
    </button>
  );
}

/* ---------- Empty ---------- */
export function Empty({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-art"><Icon size={28} /></div>
      <b>{title}</b>
      {text && <p>{text}</p>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

/* ---------- Dot-matrix hero number ---------- */
export function DotNum({ value, label, size }: { value: string; label?: string; size?: number }) {
  return <span className="dot ltr" aria-label={label ?? value} style={size ? { fontSize: size } : undefined}><span aria-hidden>{value}</span></span>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" className="toggle" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export { Check };
