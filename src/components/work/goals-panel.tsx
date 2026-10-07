import { Target } from 'lucide-react';
import { goalsFor, PEOPLE, type Place } from '@/server/entries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { GoalForm } from './goal-form';
import { GoalRow } from './goal-row';
import { NotReady } from './not-ready';

export async function GoalsPanel({ place, path, title = 'יעדים', defaultUnit, withOwner = false }: {
  place: Place; path: string; title?: string; defaultUnit?: 'ils' | 'count' | 'pct'; withOwner?: boolean;
}) {
  const { ready, goals } = await goalsFor(place);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className="text-sm text-muted">{goals.filter(g => g.status === 'active').length} פעילים</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {ready ? <GoalForm domain={place.domain} branch={place.branch} location={place.location} path={path}
          defaultUnit={defaultUnit} owners={withOwner ? PEOPLE : undefined} /> : <NotReady what="יעדים" />}
        {goals.length === 0 ? (
          <Empty icon={<Target className="size-6" />} title="עוד אין יעדים">יעד עם מספר ותאריך יופיע כאן עם פס התקדמות.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--border)]">
            {goals.map(g => <GoalRow key={g.id} goal={g} path={path} />)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
