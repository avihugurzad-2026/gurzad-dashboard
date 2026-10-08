import { ListChecks } from 'lucide-react';
import { peopleNames, workItems } from '@/server/entries';
import { requireUser } from '@/server/auth';
import type { Place } from '@/lib/places';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { QuickTask } from './quick-task';
import { TaskRow } from './task-row';
import { NotReady } from './not-ready';

// Tasks for one place: quick add (pre-filled with this place), then dashboard and vault tasks, most urgent first
export async function TaskBoard({ place, path, title = 'משימות', category, withOwner = false, showContext = false, includeDone = false }: {
  place: Place; path: string; title?: string; category?: string | null; withOwner?: boolean; showContext?: boolean; includeDone?: boolean;
}) {
  const [{ ready, items }, names, me] = await Promise.all([workItems({ ...place, category }, { includeDone }), peopleNames(), requireUser()]);
  const open = items.filter(i => i.status !== 'done' && i.status !== 'cancelled');
  const overdue = open.filter(i => i.days_past).length;
  // Who does it: shown when it's someone else's, or always on shared lists
  const ownerLabel = (i: (typeof items)[number]) => {
    const who = i.assigned_to ?? i.owner;
    return who && (withOwner || who !== me.id) ? names[who] : undefined;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className="text-sm text-muted tabular">{includeDone ? `${items.length} בארכיון` : `${open.length} פתוחות`}{overdue ? ` · ${overdue} באיחור` : ''}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {ready ? <QuickTask place={place} path={path} className="rounded-lg border border-line bg-surface-2/40 p-3" /> : <NotReady what="משימות" />}
        {items.length === 0 ? (
          <Empty icon={<ListChecks aria-hidden />} title="אין משימות פתוחות">משימה חדשה נכנסת מהשורה למעלה.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--border)]">
            {items.map(i => <TaskRow key={`${i.source}-${i.id}`} item={i} path={path} ownerLabel={ownerLabel(i)}
              showContext={showContext || (place.domain === 'business' && !place.location && !!i.location)} />)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
