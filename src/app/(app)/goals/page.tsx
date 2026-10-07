import Link from 'next/link';
import { Target } from 'lucide-react';
import { goalsFor } from '@/server/entries';
import { GOAL_TYPES, goalTypeLabel } from '@/lib/goals';
import { contextLabel } from '@/lib/places';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { GoalRow } from '@/components/work/goal-row';
import { GoalForm } from '@/components/work/goal-form';
import { cn } from '@/lib/utils';

export const metadata = { title: 'יעדים — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

// Every goal the user may see, across areas, filtered by type. New goals are added from here
// (Personal) or from each business/branch page, where the place is pre-set.
export default async function GoalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const type = (await searchParams).type;
  const active = GOAL_TYPES.some(t => t.id === type) ? type! : null;
  const { ready, goals } = await goalsFor({});
  const shown = active ? goals.filter(g => g.goal_type === active) : goals;
  const count = (t: string | null) => goals.filter(g => g.status === 'active' && (t === null || g.goal_type === t)).length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">יעדים</h1>
        <p className="text-sm text-muted">כל היעדים במקום אחד: אישי, עסקי, סניף, פיננסי, לימודים ויזמות</p>
      </div>
      <nav aria-label="סוג יעד" className="flex flex-wrap gap-1.5">
        {[{ id: null, label: 'הכל' }, ...GOAL_TYPES].map(t => (
          <Link key={t.id ?? 'all'} href={t.id ? `/goals?type=${t.id}` : '/goals'} aria-current={active === t.id ? 'page' : undefined}
            className={cn('rounded-full border px-3 py-1 text-sm', active === t.id ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line hover:bg-surface-2')}>
            {t.label}{count(t.id) > 0 && <span className="ms-1 text-xs text-muted">{count(t.id)}</span>}
          </Link>
        ))}
      </nav>
      <Card>
        <CardHeader><CardTitle>{active ? `יעדים: ${goalTypeLabel(active)}` : 'כל היעדים'}</CardTitle><span className="text-sm text-muted">{shown.filter(g => g.status === 'active').length} פעילים</span></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {ready && <GoalForm domain="personal" path="/goals" owners />}
          {shown.length === 0 ? (
            <Empty icon={<Target className="size-6" />} title="אין יעדים עדיין">יעד עם מספר ותאריך יופיע כאן עם פס התקדמות. יעד של עסק או סניף מוסיפים מהעמוד שלו.</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {shown.map(g => <GoalRow key={g.id} goal={g} path="/goals" context={contextLabel({ domain: g.domain, branch: g.branch, location: g.location })} />)}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
