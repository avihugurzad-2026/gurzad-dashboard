'use client';
import { useTransition } from 'react';
import { Circle, CircleCheck, CircleDot, Clock, Trash2 } from 'lucide-react';
import { removeTask, setTaskPriority, setTaskStatus } from '@/app/actions';
import { Badge } from '@/components/ui/badge';
import { shortDate } from '@/lib/format';
import { PRIORITIES, STATUSES } from '@/lib/places';
import { cn } from '@/lib/utils';
import type { WorkItem } from '@/server/entries';

const selectClass = 'h-7 rounded-md border border-line bg-surface px-1 text-xs text-ink-2';

// One task: tick to finish, status and priority inline, the context badge says where it belongs
export function TaskRow({ item, path, ownerLabel, showContext = true }: {
  item: WorkItem; path: string; ownerLabel?: string; showContext?: boolean;
}) {
  const [pending, start] = useTransition();
  const vault = item.source === 'vault';
  const closed = item.status === 'done' || item.status === 'cancelled';
  const Icon = item.status === 'done' ? CircleCheck : item.status === 'in_progress' ? CircleDot : item.status === 'waiting' ? Clock : Circle;
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); });

  return (
    <li className={cn('flex items-start gap-3 py-2.5', pending && 'opacity-60')}>
      <button type="button" disabled={vault || pending}
        onClick={() => run(() => setTaskStatus(item.id, item.status === 'done' ? 'todo' : 'done', path))}
        aria-label={vault ? 'משימה מהוואלט: לקריאה בלבד' : item.status === 'done' ? 'החזר לפתוחה' : 'סמן כבוצעה'}
        className={cn('mt-0.5 shrink-0', item.status === 'done' ? 'text-good' : item.status === 'in_progress' ? 'text-accent' : 'text-muted', !vault && 'hover:text-ink')}>
        <Icon className="size-5" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm text-ink', closed && 'text-muted line-through')}><bdi>{item.title}</bdi></p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {showContext && <Badge tone="accent"><bdi dir="rtl">{item.context}</bdi></Badge>}
          {item.priority <= 2 && !closed && <Badge tone={item.priority === 1 ? 'critical' : 'warning'}>P{item.priority}</Badge>}
          {item.status === 'waiting' && <Badge tone="warning">ממתין{item.waiting_on ? ` ל${item.waiting_on}` : ''}</Badge>}
          {item.due_date && (
            <span className={cn(item.days_past ? 'font-medium text-critical-ink' : '')}>
              {item.days_past ? `באיחור ${item.days_past} ימים · ` : 'עד '}{shortDate(item.due_date)}{item.due_time ? `, ${item.due_time}` : ''}
            </span>
          )}
          {ownerLabel && <span>{ownerLabel}</span>}
          {vault && <Badge>מהוואלט</Badge>}
          {item.description && <span className="truncate"><bdi>{item.description}</bdi></span>}
        </div>
      </div>
      {!vault && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <label className="sr-only" htmlFor={`st-${item.id}`}>סטטוס</label>
          <select id={`st-${item.id}`} value={item.status} disabled={pending} className={cn(selectClass, 'hidden sm:block')}
            onChange={e => run(() => setTaskStatus(item.id, e.target.value, path))}>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <label className="sr-only" htmlFor={`pr-${item.id}`}>עדיפות</label>
          <select id={`pr-${item.id}`} value={item.priority} disabled={pending} className={selectClass}
            onChange={e => run(() => setTaskPriority(item.id, Number(e.target.value), path))}>
            {PRIORITIES.map(p => <option key={p.value} value={p.value}>P{p.value}</option>)}
          </select>
          <button type="button" disabled={pending} aria-label="מחק משימה"
            onClick={() => { if (confirm('למחוק את המשימה?')) run(() => removeTask(item.id, path)); }}
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-critical-ink">
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </li>
  );
}
