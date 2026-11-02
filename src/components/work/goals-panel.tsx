import { Target } from 'lucide-react';
import { goalsFor, type Place } from '@/server/entries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { GoalForm } from './goal-form';
import { GoalRow } from './goal-row';
import { NotReady } from './not-ready';

export async function GoalsPanel({ place, path, title = 'יעדים', defaultUnit, withOwner = false }: {
  place: Place; path: string; title?: string; defaultUnit?: 'ils' | 'count' | 'pct'; withOwner?: boolean;
}) {
  const { ready, goals: all } = await goalsFor(place, { withDropped: true });
  const goals = all.filter(g => g.status !== 'dropped');
  const dropped = all.filter(g => g.status === 'dropped');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className="text-sm text-muted">{goals.filter(g => g.status === 'active').length} פעילים</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {ready ? <GoalForm domain={place.domain} branch={place.branch} location={place.location} path={path}
          defaultUnit={defaultUnit} owners={withOwner} /> : <NotReady what="יעדים" />}
        {goals.length === 0 ? (
          <Empty icon={<Target aria-hidden />} title="עוד אין יעדים">יעד עם מספר ותאריך יופיע כאן עם פס התקדמות.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--border)]">
            {goals.map(g => <GoalRow key={g.id} goal={g} path={path} />)}
          </ul>
        )}
        {dropped.length > 0 && (
          <details className="rounded-lg border border-line px-3 py-2">
            <summary className="cursor-pointer text-sm text-ink-2">יעדים שהוסרו ({dropped.length})</summary>
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {dropped.map(g => <GoalRow key={g.id} goal={g} path={path} />)}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
