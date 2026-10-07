'use client';
import { useTransition } from 'react';
import { Circle, CircleCheck, CircleDot, Trash2 } from 'lucide-react';
import { removeTask, setTaskPriority, setTaskStatus } from '@/app/actions';
import { Badge } from '@/components/ui/badge';
import { shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { WorkItem } from '@/server/entries';

const PRIORITY = { 1: { label: 'גבוהה', tone: 'critical' }, 2: { label: 'רגילה', tone: 'neutral' }, 3: { label: 'נמוכה', tone: 'neutral' } } as const;
const NEXT = { open: 'doing', doing: 'done', done: 'open' } as const;
const STATUS_LABEL = { open: 'פתוחה', doing: 'בעבודה', done: 'בוצעה' } as const;

export function TaskRow({ item, path, listLabel, ownerLabel }: { item: WorkItem; path: string; listLabel?: string; ownerLabel?: string }) {
  const [pending, start] = useTransition();
  const vault = item.source === 'vault';
  const Icon = item.status === 'done' ? CircleCheck : item.status === 'doing' ? CircleDot : Circle;

  return (
    <li className={cn('flex items-start gap-3 py-2.5', pending && 'opacity-60')}>
      <button type="button" disabled={vault || pending}
        onClick={() => start(async () => { await setTaskStatus(item.id, NEXT[item.status], path); })}
        aria-label={vault ? 'משימה מהוואלט: לקריאה בלבד' : `סטטוס: ${STATUS_LABEL[item.status]}. לחץ לשינוי`}
        className={cn('mt-0.5 shrink-0', item.status === 'done' ? 'text-good' : item.status === 'doing' ? 'text-accent' : 'text-muted', !vault && 'hover:text-ink')}>
        <Icon className="size-5" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm text-ink', item.status === 'done' && 'text-muted line-through')}><bdi>{item.title}</bdi></p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {item.priority === 1 && <Badge tone="critical">עדיפות גבוהה</Badge>}
          {item.status === 'doing' && <Badge tone="accent">בעבודה</Badge>}
          {item.due && (
            <span className={cn(item.days_past ? 'font-medium text-critical-ink' : '')}>
              {item.days_past ? `באיחור ${item.days_past} ימים · ` : 'עד '}{shortDate(item.due)}
            </span>
          )}
          {(listLabel || ownerLabel) && <span>{[listLabel, ownerLabel].filter(Boolean).join(' · ')}</span>}
          {vault && <Badge>מהוואלט</Badge>}
          {item.notes && <span className="truncate"><bdi>{item.notes}</bdi></span>}
        </div>
      </div>
      {!vault && (
        <div className="flex shrink-0 items-center gap-1">
          <label className="sr-only" htmlFor={`pr-${item.id}`}>עדיפות</label>
          <select id={`pr-${item.id}`} value={item.priority} disabled={pending}
            onChange={e => start(async () => { await setTaskPriority(item.id, Number(e.target.value), path); })}
            className="h-7 rounded-md border border-line bg-surface px-1 text-xs text-ink-2">
            {([1, 2, 3] as const).map(p => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
          </select>
          <button type="button" disabled={pending} aria-label="מחק משימה"
            onClick={() => { if (confirm('למחוק את המשימה?')) start(async () => { await removeTask(item.id, path); }); }}
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-critical-ink">
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </li>
  );
}
