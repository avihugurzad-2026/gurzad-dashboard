import { useState, type CSSProperties, type ReactNode, type FormEvent } from 'react';
import { catVar, categoryOf } from '../../shared/planner';
import { AnimatePresence, motion } from 'motion/react';
import { ListChecks, Pencil, Plus, Repeat, Trash2, User, type LucideIcon } from 'lucide-react';
import type { Collection, Rec } from '../data/types';
import { store } from '../data/store';
import { daysUntil, relDay, addDays, today } from '../lib/format';
import { useCrud } from './crud';
import { Badge, CheckBox, Empty, easeOut } from './kit';
import { useToast } from './overlay';

const rowAnim = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto', transition: { duration: 0.22, ease: easeOut } },
  exit: { opacity: 0, height: 0, transition: { duration: 0.16 } },
};

/* ---------- Quick add (one line) ---------- */
export function QuickAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => void }) {
  const [v, setV] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); const t = v.trim(); if (!t) return; onAdd(t); setV(''); };
  return (
    <form className="quick-add" onSubmit={submit}>
      <input className="input" dir="auto" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} aria-label={placeholder} enterKeyHint="done" />
      <button className="btn btn-primary" style={{ width: 44, padding: 0, flexShrink: 0 }} aria-label="הוספה" disabled={!v.trim()}><Plus size={18} /></button>
    </form>
  );
}

/* ---------- Tasks ---------- */
const NEXT: Record<string, number> = { 'כל יום': 1, 'כל שבוע': 7, 'כל חודש': 30 };

/** Mark a task done. A recurring task rolls its due date forward instead of closing. */
export function toggleTask(collection: Collection, t: Rec, done: boolean, toast: (text: string, undo?: () => void) => void) {
  if (done && NEXT[t.repeat]) {
    const prev = t.due;
    const base = t.due && daysUntil(t.due) > 0 ? t.due : today();
    store.update(collection, t.id, { due: addDays(base, NEXT[t.repeat]) });
    toast(`בוצע · חוזר ${relDay(addDays(base, NEXT[t.repeat]))}`, () => store.update(collection, t.id, { due: prev }));
    return;
  }
  store.update(collection, t.id, { done });
}

export function TaskList({ collection, rows, scope, hideDone, emptyText }: { collection: Collection; rows: Rec[]; scope?: Record<string, any>; hideDone?: boolean; emptyText?: string }) {
  const crud = useCrud(collection, scope);
  const toast = useToast();
  const sorted = [...rows].filter((t) => !hideDone || !t.done).sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9') .localeCompare(b.due || '9'));

  const toggle = (t: Rec, done: boolean) => toggleTask(collection, t, done, toast);

  return (
    <>
      <QuickAdd placeholder="משימה חדשה… Enter להוספה" onAdd={(title) => store.add(collection, { ...scope, title, done: false, priority: 'רגילה', repeat: 'לא חוזר' })} />
      {sorted.length === 0 ? <Empty icon={ListChecks} title="אין משימות פתוחות" text={emptyText ?? 'כתוב משימה בשורה למעלה ולחץ Enter.'} /> : (
        <div className="list">
          <AnimatePresence initial={false}>
            {sorted.map((t) => {
              const late = !t.done && t.due && daysUntil(t.due) < 0;
              return (
                <motion.div key={t.id} layout="position" {...rowAnim} style={{ overflow: 'hidden' }}>
                  <div className="li clickable" onClick={() => crud.openEdit(t)}>
                    <CheckBox checked={!!t.done} onChange={(v) => toggle(t, v)} label={`סימון: ${t.title}`} />
                    <div className="li-main">
                      <div className={`li-title ${t.done ? 'done' : ''}`}>{t.title}</div>
                      <div className="li-meta">
                        <span className="cat-dot" style={{ '--cat': catVar(categoryOf(collection, t)) } as CSSProperties} aria-hidden />
                        {t.due && <span className={late ? 'neg' : ''}>{relDay(t.due)}{t.time ? ` · ${t.time}` : ''}</span>}
                        {t.assignee && <span className="row" style={{ gap: 3 }}><User size={12} />{t.assignee}</span>}
                        {t.vendor && <span>{t.vendor}</span>}
                        {t.repeat && t.repeat !== 'לא חוזר' && <span className="row" style={{ gap: 3 }}><Repeat size={12} />{t.repeat}</span>}
                      </div>
                    </div>
                    <div className="li-end">
                      {late && <Badge kind="neg">באיחור</Badge>}
                      {!late && t.priority === 'גבוהה' && !t.done && <Badge kind="warn">דחוף</Badge>}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
      {crud.sheet}
    </>
  );
}

/* ---------- Generic record list ---------- */
export function RecordList({ collection, rows, scope, icon: Icon, title, meta, end, emptyTitle, emptyText, hide }: {
  collection: Collection; rows: Rec[]; scope?: Record<string, any>; icon: LucideIcon;
  title: (r: Rec) => ReactNode; meta?: (r: Rec) => ReactNode; end?: (r: Rec) => ReactNode;
  emptyTitle: string; emptyText?: string; hide?: string[];
}) {
  const crud = useCrud(collection, scope, { hide });
  return (
    <>
      {rows.length === 0 ? (
        <Empty icon={Icon} title={emptyTitle} text={emptyText} action={<button className="btn btn-soft" onClick={() => crud.openNew()}><Plus size={16} />{crud.schema.singular} ראשון/ה</button>} />
      ) : (
        <div className="list">
          <AnimatePresence initial={false}>
            {rows.map((r) => (
              <motion.div key={r.id} layout="position" {...rowAnim} style={{ overflow: 'hidden' }}>
                <div className="li clickable" onClick={() => crud.openEdit(r)} tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === 'Enter') crud.openEdit(r); }}>
                  <span className="li-icon"><Icon size={18} /></span>
                  <div className="li-main"><div className="li-title">{title(r)}</div>{meta && <div className="li-meta">{meta(r)}</div>}</div>
                  <div className="li-end">
                    {end?.(r)}
                    <span className="li-actions hide-sm">
                      <button className="icon-btn bare" aria-label="עריכה" onClick={(e) => { e.stopPropagation(); crud.openEdit(r); }}><Pencil size={15} /></button>
                      <button className="icon-btn bare" aria-label="מחיקה" onClick={(e) => { e.stopPropagation(); crud.remove(r); }}><Trash2 size={15} /></button>
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
      {crud.sheet}
    </>
  );
}

/** Header "add" button wired to the same collection (separate sheet instance). */
export function useAdder(collection: Collection, scope?: Record<string, any>, hide?: string[]) {
  return useCrud(collection, scope, { hide });
}
