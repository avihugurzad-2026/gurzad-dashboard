'use client';
import { report } from '@/lib/report';
import { useTransition } from 'react';
import { CalendarDays, Circle, CircleCheck, CircleDot, Clock, Trash2, User } from 'lucide-react';
import { removeTask, setTaskPriority, setTaskStatus } from '@/app/actions';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { compactInputClass } from '@/components/work/fields';
import { shortDate } from '@/lib/format';
import { PRIORITIES, STATUSES } from '@/lib/places';
import { cn } from '@/lib/utils';
import type { WorkItem } from '@/server/entries';

const rowSelect = cn(compactInputClass, 'w-auto pe-7');

// One task row, the same on every workspace: tick, title, then context / priority / due / status
// badges underneath, and the inline controls (status, priority, delete) on the inline-end.
export function TaskRow({ item, path, ownerLabel, showContext = true }: {
  item: WorkItem; path: string; ownerLabel?: string; showContext?: boolean;
}) {
  const [pending, start] = useTransition();
  const vault = item.source === 'vault';
  const closed = item.status === 'done' || item.status === 'cancelled';
  const Icon = item.status === 'done' ? CircleCheck : item.status === 'in_progress' ? CircleDot : item.status === 'waiting' ? Clock : Circle;
  const run = (fn: () => Promise<unknown>) => start(async () => { report(await fn()); });
  const due = item.due_date ? `${shortDate(item.due_date)}${item.due_time ? `, ${item.due_time}` : ''}` : null;

  return (
    <li className={cn('flex items-start gap-3 py-3', pending && 'opacity-60')}>
      <button type="button" disabled={vault || pending}
        onClick={() => run(() => setTaskStatus(item.id, item.status === 'done' ? 'todo' : 'done', path))}
        aria-label={vault ? 'משימה מהוואלט: לקריאה בלבד' : item.status === 'done' ? 'החזר לפתוחה' : 'סמן כבוצעה'}
        className={cn('mt-0.5 shrink-0 rounded-full', item.status === 'done' ? 'text-good' : item.status === 'in_progress' ? 'text-accent' : 'text-muted', !vault && 'hover:text-ink')}>
        <Icon className="size-5" aria-hidden />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className={cn('text-body font-medium text-ink', closed && 'font-normal text-muted line-through')}><bdi>{item.title}</bdi></p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {showContext && <Badge tone="accent"><bdi dir="rtl">{item.context}</bdi></Badge>}
          {item.priority <= 2 && !closed && <Badge tone={item.priority === 1 ? 'critical' : 'warning'}>P{item.priority}</Badge>}
          {item.status === 'waiting' && <Badge tone="warning">ממתין{item.waiting_on ? <> ל<bdi>{item.waiting_on}</bdi></> : ''}</Badge>}
          {due && (item.days_past
            ? <Badge tone="critical"><CalendarDays aria-hidden />באיחור {item.days_past} ימים · {due}</Badge>
            : <span className="inline-flex items-center gap-1"><CalendarDays className="size-4" aria-hidden />עד {due}</span>)}
          {ownerLabel && <span className="inline-flex items-center gap-1"><User className="size-4" aria-hidden /><bdi>{ownerLabel}</bdi></span>}
          {vault && <Badge>מהוואלט</Badge>}
          {item.description && <span className="min-w-0 max-w-full truncate"><bdi>{item.description}</bdi></span>}
        </div>
      </div>
      {!vault && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
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
          <button type="button" disabled={pending} aria-label="מחק משימה"
            onClick={() => { if (confirm('למחוק את המשימה?')) run(() => removeTask(item.id, path)); }}
            className={buttonClass('ghost', 'icon', 'size-8 text-muted hover:text-critical-ink')}>
            <Trash2 aria-hidden />
          </button>
        </div>
      )}
    </li>
  );
}
