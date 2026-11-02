import { deletedWorkItems, peopleNames, workItems } from '@/server/entries';
import { requireUser } from '@/server/auth';
import type { Place } from '@/lib/places';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QuickTask } from './quick-task';
import { TaskViews } from './task-views';
import { NotReady } from './not-ready';

// Tasks for one place: quick add (pre-filled with this place), then the open / closed / trash lists,
// most urgent first. `includeDone` opens the board on the closed list.
export async function TaskBoard({ place, path, title = 'משימות', category, withOwner = false, showContext = false, includeDone = false }: {
  place: Place; path: string; title?: string; category?: string | null; withOwner?: boolean; showContext?: boolean; includeDone?: boolean;
}) {
  const [{ ready, items }, trash, names, me] = await Promise.all([
    workItems({ ...place, category }, { includeDone: true }), deletedWorkItems({ ...place, category }), peopleNames(), requireUser(),
  ]);
  const open = items.filter(i => i.status !== 'done' && i.status !== 'cancelled');
  const overdue = open.filter(i => i.days_past).length;
  // Who does it: shown when it's someone else's, or always on shared lists
  const labels: Record<string, string | undefined> = {};
  const contextFor: Record<string, boolean> = {};
  for (const i of [...items, ...trash]) {
    const who = i.assigned_to ?? i.owner;
    labels[i.id] = who && (withOwner || who !== me.id) ? names[who] : undefined;
    contextFor[i.id] = showContext || (place.domain === 'business' && !place.location && !!i.location);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className="text-sm text-muted tabular">{`${open.length} פתוחות`}{overdue ? ` · ${overdue} באיחור` : ''}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {ready ? <QuickTask place={place} path={path} className="rounded-lg border border-line bg-surface-2/40 p-3" /> : <NotReady what="משימות" />}
        <TaskViews items={items} trash={trash} path={path} labels={labels} contextFor={contextFor} initial={includeDone ? 'closed' : 'open'} />
      </CardContent>
    </Card>
  );
}
