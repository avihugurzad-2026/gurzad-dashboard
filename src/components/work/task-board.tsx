import { ListChecks } from 'lucide-react';
import { workItems, PEOPLE } from '@/server/entries';
import type { Place } from '@/lib/places';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { QuickTask } from './quick-task';
import { TaskRow } from './task-row';
import { NotReady } from './not-ready';

// Tasks for one place: quick add (pre-filled with this place), then dashboard and vault tasks, most urgent first
export async function TaskBoard({ place, path, title = 'משימות', category, withOwner = false, showContext = false }: {
  place: Place; path: string; title?: string; category?: string | null; withOwner?: boolean; showContext?: boolean;
}) {
  const { ready, items } = await workItems({ ...place, category });
  const open = items.filter(i => i.status !== 'done' && i.status !== 'cancelled');
  const overdue = open.filter(i => i.days_past).length;
  const ownerLabel = (o: string | null) => (withOwner && o ? PEOPLE.find(p => p.id === o)?.name : undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className="text-sm text-muted">{open.length} פתוחות{overdue ? ` · ${overdue} באיחור` : ''}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {ready ? <QuickTask place={place} path={path} className="rounded-lg border border-line bg-surface-2/40 p-3" /> : <NotReady what="משימות" />}
        {items.length === 0 ? (
          <Empty icon={<ListChecks className="size-6" />} title="אין משימות פתוחות">משימה חדשה נכנסת מהשורה למעלה.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--border)]">
            {items.map(i => <TaskRow key={`${i.source}-${i.id}`} item={i} path={path} ownerLabel={ownerLabel(i.owner)}
              showContext={showContext || (place.domain === 'business' && !place.location && !!i.location)} />)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
