import { ListChecks } from 'lucide-react';
import { workItems, PEOPLE, type Place } from '@/server/entries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { TaskForm } from './task-form';
import { TaskRow } from './task-row';
import { NotReady } from './not-ready';

// Tasks for one place: the add form, then dashboard and vault tasks together, most urgent first
export async function TaskBoard({ place, path, title = 'משימות', lists, defaultList, withOwner = false }: {
  place: Place; path: string; title?: string;
  lists?: readonly { key: string; label: string }[]; defaultList?: string | null; withOwner?: boolean;
}) {
  const { ready, items } = await workItems(place);
  const open = items.filter(i => i.status !== 'done');
  const overdue = open.filter(i => i.days_past).length;
  const listLabel = (k: string | null) => lists?.find(l => l.key === k)?.label;
  const ownerLabel = (o: string | null) => (withOwner && o ? PEOPLE.find(p => p.id === o)?.name : undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className="text-sm text-muted">{open.length} פתוחות{overdue ? ` · ${overdue} באיחור` : ''}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {ready ? (
          <TaskForm domain={place.domain} branch={place.branch} location={place.location} path={path}
            lists={lists} defaultList={defaultList} owners={withOwner ? PEOPLE : undefined} />
        ) : <NotReady what="משימות" />}
        {items.length === 0 ? (
          <Empty icon={<ListChecks className="size-6" />} title="אין משימות פתוחות">משימה חדשה נכנסת מהשורה למעלה.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--border)]">
            {items.map(i => <TaskRow key={`${i.source}-${i.id}`} item={i} path={path} listLabel={listLabel(i.list)} ownerLabel={ownerLabel(i.owner)} />)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
