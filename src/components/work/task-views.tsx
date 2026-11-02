'use client';
import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Empty } from '@/components/ui/empty';
import { cn } from '@/lib/utils';
import type { WorkItem } from '@/server/entries';
import { TaskRow } from './task-row';

export type TaskView = 'open' | 'closed' | 'trash';
const isClosed = (i: WorkItem) => i.status === 'done' || i.status === 'cancelled';

// The board's three lists: open tasks, closed ones (done and cancelled, nothing hidden by age),
// and the trash (deleted tasks this user may restore).
export function TaskViews({ items, trash, path, labels, contextFor, initial = 'open' }: {
  items: WorkItem[]; trash: WorkItem[]; path: string; labels: Record<string, string | undefined>;
  contextFor: Record<string, boolean>; initial?: TaskView;
}) {
  const [view, setView] = useState<TaskView>(initial);
  const open = items.filter(i => !isClosed(i));
  const closed = items.filter(isClosed)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const list = view === 'open' ? open : view === 'closed' ? closed : trash;
  const tabs: { key: TaskView; label: string; count: number }[] = [
    { key: 'open', label: 'פתוחות', count: open.length },
    { key: 'closed', label: 'סגורות', count: closed.length },
    { key: 'trash', label: 'סל מחזור', count: trash.length },
  ];
  const empty = view === 'open' ? 'אין משימות פתוחות' : view === 'closed' ? 'אין משימות סגורות' : 'סל המחזור ריק';

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="תצוגת משימות" className="flex flex-wrap gap-1.5">
        {tabs.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={view === t.key} onClick={() => setView(t.key)}
            className={cn('h-8 rounded-full border px-3 text-sm', view === t.key ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-ink-2 hover:bg-surface-2')}>
            {t.label} <span className="tabular text-muted">{t.count}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty icon={<ListChecks aria-hidden />} title={empty}>{view === 'open' ? 'משימה חדשה נכנסת מהשורה למעלה.' : ''}</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-[color:var(--border)]">
          {list.map(i => <TaskRow key={`${i.source}-${i.id}`} item={i} path={path} ownerLabel={labels[i.id]} showContext={contextFor[i.id]} />)}
        </ul>
      )}
    </div>
  );
}
