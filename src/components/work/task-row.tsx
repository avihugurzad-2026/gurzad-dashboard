'use client';
import { report } from '@/lib/report';
import { submitWith } from '@/lib/submit';
import { useActionState, useEffect, useId, useState, useTransition } from 'react';
import { CalendarDays, Circle, CircleCheck, CircleDot, CircleX, Clock, Pencil, RotateCcw, Trash2, User } from 'lucide-react';
import { removeTask, restoreTask, setTaskPriority, setTaskStatus, updateTask, type ActionResult } from '@/app/actions';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { useSession } from '@/components/shell/session-context';
import { compactInputClass, inputClass, labelClass, selectClass, textareaClass } from '@/components/work/fields';
import { shortDate } from '@/lib/format';
import { categoriesFor, PRIORITIES, STATUSES } from '@/lib/places';
import { cn } from '@/lib/utils';
import type { WorkItem } from '@/server/entries';

const rowSelect = cn(compactInputClass, 'w-auto pe-7');

// One task row, the same on every workspace: tick, title, then context / priority / due / status
// badges underneath, and the inline controls (status, priority, edit, delete) on the inline-end.
// Controls follow the user's rights on this row; a deleted row (trash view) only offers restore.
export function TaskRow({ item, path, ownerLabel, showContext = true }: {
  item: WorkItem; path: string; ownerLabel?: string; showContext?: boolean;
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const vault = item.source === 'vault';
  const trashed = Boolean(item.deleted_at);
  const editable = !vault && !trashed && item.can_edit;
  const closed = item.status === 'done' || item.status === 'cancelled';
  const Icon = item.status === 'done' ? CircleCheck : item.status === 'cancelled' ? CircleX
    : item.status === 'in_progress' ? CircleDot : item.status === 'waiting' ? Clock : Circle;
  const run = (fn: () => Promise<unknown>) => start(async () => { report(await fn()); });
  const due = item.due_date ? `${shortDate(item.due_date)}${item.due_time ? `, ${item.due_time}` : ''}` : null;
  // The circle closes an open task, and reopens a closed one (done or cancelled) — never turns cancelled into done
  const tickLabel = vault ? 'משימה מהוואלט: לקריאה בלבד' : !editable ? 'אין לך הרשאה לעדכן את המשימה'
    : closed ? 'פתח מחדש' : 'סמן כבוצעה';

  return (
    <li className={cn('flex flex-col py-3', pending && 'opacity-60')}>
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        <button type="button" disabled={!editable || pending} title={tickLabel} aria-label={tickLabel}
          onClick={() => run(() => setTaskStatus(item.id, closed ? 'todo' : 'done', path))}
          className={cn('mt-0.5 shrink-0 rounded-full', item.status === 'done' ? 'text-good' : item.status === 'in_progress' ? 'text-accent' : 'text-muted', editable && 'hover:text-ink')}>
          <Icon className="size-5" aria-hidden />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {editable ? (
            <button type="button" onClick={() => setEditing(e => !e)} aria-expanded={editing}
              className={cn('text-start text-body font-medium text-ink hover:underline', closed && 'font-normal text-muted line-through')}>
              <bdi>{item.title}</bdi>
            </button>
          ) : (
            <p className={cn('text-body font-medium text-ink', closed && 'font-normal text-muted line-through')}><bdi>{item.title}</bdi></p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {showContext && <Badge tone="accent"><bdi dir="rtl">{item.context}</bdi></Badge>}
            {item.status === 'cancelled' && <Badge>בוטל</Badge>}
            {item.status === 'done' && <Badge tone="good">בוצע</Badge>}
            {item.priority <= 2 && !closed && <Badge tone={item.priority === 1 ? 'critical' : 'warning'}>P{item.priority}</Badge>}
            {item.status === 'waiting' && <Badge tone="warning">ממתין{item.waiting_on ? <> ל<bdi>{item.waiting_on}</bdi></> : ''}</Badge>}
            {due && (item.days_past
              ? <Badge tone="critical"><CalendarDays aria-hidden />באיחור {item.days_past} ימים · {due}</Badge>
              : <span className="inline-flex items-center gap-1"><CalendarDays className="size-4" aria-hidden />עד {due}</span>)}
            {ownerLabel && <span className="inline-flex items-center gap-1"><User className="size-4" aria-hidden /><bdi>{ownerLabel}</bdi></span>}
            {vault && <Badge>מהוואלט</Badge>}
            {trashed && item.deleted_at && <span>נמחקה ב-{shortDate(item.deleted_at.slice(0, 10))}</span>}
            {item.description && <span className="min-w-0 max-w-full truncate"><bdi>{item.description}</bdi></span>}
          </div>
        </div>
        {trashed ? (
          <div className="flex w-full shrink-0 justify-end sm:w-auto">
            <Button size="sm" variant="secondary" disabled={pending || !item.can_delete} onClick={() => run(() => restoreTask(item.id, path))}>
              <RotateCcw aria-hidden />שחזר
            </Button>
          </div>
        ) : !vault && (editable || item.can_delete) && (
          <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1.5 sm:w-auto">
            {editable && <>
              <label className="sr-only" htmlFor={`st-${item.id}`}>סטטוס</label>
              <select id={`st-${item.id}`} value={item.status} disabled={pending} className={rowSelect}
                onChange={e => run(() => setTaskStatus(item.id, e.target.value, path))}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <label className="sr-only" htmlFor={`pr-${item.id}`}>עדיפות</label>
              <select id={`pr-${item.id}`} value={item.priority} disabled={pending} className={rowSelect}
                onChange={e => run(() => setTaskPriority(item.id, Number(e.target.value), path))}>
                {PRIORITIES.map(p => <option key={p.value} value={p.value}>P{p.value}</option>)}
              </select>
              <button type="button" disabled={pending} aria-label="ערוך משימה" onClick={() => setEditing(e => !e)}
                className={buttonClass('ghost', 'icon', 'size-8 text-muted hover:text-ink')}>
                <Pencil aria-hidden />
              </button>
            </>}
            {item.can_delete && (
              <button type="button" disabled={pending} aria-label="מחק משימה"
                onClick={() => { if (confirm('למחוק את המשימה? אפשר לשחזר מסל המחזור.')) run(() => removeTask(item.id, path)); }}
                className={buttonClass('ghost', 'icon', 'size-8 text-muted hover:text-critical-ink')}>
                <Trash2 aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>
      {editing && editable && <TaskEdit item={item} path={path} onDone={() => setEditing(false)} />}
    </li>
  );
}

// Edit every field of a task in place. "Who does it" only where tasks can be shared (not Personal).
function TaskEdit({ item, path, onDone }: { item: WorkItem; path: string; onDone: () => void }) {
  const session = useSession();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updateTask, null);
  const [status, setStatus] = useState<string>(item.status);
  const id = useId();
  const cats = categoriesFor(item.domain as Parameters<typeof categoriesFor>[0]);
  const shared = item.domain !== 'personal' && session && session.people.length > 1;
  const who = item.assigned_to ?? item.owner ?? '';

  useEffect(() => {
    if (!state?.ok) return;
    if (state.warning) alert(state.warning);
    onDone();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form onSubmit={submitWith(action)} className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4 rounded-lg border border-line bg-surface-2/40 p-3 sm:grid-cols-4">
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="path" value={path} />
      <label className={cn(labelClass, 'col-span-2 flex flex-col gap-1.5 sm:col-span-4')}>כותרת
        <input name="title" required maxLength={300} defaultValue={item.title} className={inputClass} />
      </label>
      <label className={cn(labelClass, 'col-span-2 flex flex-col gap-1.5 sm:col-span-4')}>תיאור
        <textarea name="description" maxLength={4000} defaultValue={item.description ?? ''} className={textareaClass} />
      </label>
      <label className={cn(labelClass, 'flex flex-col gap-1.5')}>סטטוס
        <select name="status" value={status} onChange={e => setStatus(e.target.value)} className={selectClass}>
          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      <label className={cn(labelClass, 'flex flex-col gap-1.5')}>עדיפות
        <select name="priority" defaultValue={String(item.priority)} className={selectClass}>
          {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      <label className={cn(labelClass, 'flex flex-col gap-1.5')}>קטגוריה
        <select name="category" defaultValue={item.category_id ?? 'general'} className={selectClass}>
          {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      {shared && (
        <label className={cn(labelClass, 'flex flex-col gap-1.5')}>מי עושה
          <select name="assigned_to" defaultValue={who} className={selectClass}>
            {!session.people.some(p => p.id === who) && who && <option value={who}>(לא ברשימה)</option>}
            {session.people.map(p => <option key={p.id} value={p.id}>{p.id === session.user.id ? `אני (${p.name})` : p.name}</option>)}
          </select>
        </label>
      )}
      <label className={cn(labelClass, 'flex flex-col gap-1.5')}>תאריך
        <DateField name="due_date" defaultValue={item.due_date ?? undefined} aria-label="תאריך" />
      </label>
      <label className={cn(labelClass, 'flex flex-col gap-1.5')}>שעה
        <input type="time" name="due_time" defaultValue={item.due_time ?? ''} className={cn(inputClass, 'tabular')} />
      </label>
      {status === 'waiting' && (
        <label className={cn(labelClass, 'col-span-2 flex flex-col gap-1.5')} htmlFor={`${id}-w`}>ממתין ל
          <input id={`${id}-w`} name="waiting_on" maxLength={100} defaultValue={item.waiting_on ?? ''} className={inputClass} />
        </label>
      )}
      <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-4">
        {state && !state.ok && <p role="alert" className="me-auto text-sm text-critical-ink">{state.error}</p>}
        <Button variant="ghost" size="sm" onClick={onDone}>ביטול</Button>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>שמור</Button>
      </div>
    </form>
  );
}
