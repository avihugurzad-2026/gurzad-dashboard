import { ospa, parseBasis } from '@/server/revenue';
import { goalsFor, openCounts } from '@/server/entries';
import { OspaView } from '@/components/ospa/ospa-view';
import { BranchCards } from '@/components/ospa/branch-cards';
import { Tabs, pickTab } from '@/components/shell/tabs';
import { TaskBoard } from '@/components/work/task-board';
import { GoalsPanel } from '@/components/work/goals-panel';

export const metadata = { title: 'הד ספא ישראל — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const BASE = '/business/head-spa-israel';
const PLACE = { domain: 'business', branch: 'head-spa-israel', location: null } as const;
const TABS = ['overview', 'tasks', 'goals'] as const;

// The company level: all branches together, then a card per branch. Tasks and goals here
// cover the whole company; each branch page has its own.
export default async function HeadSpaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tab = pickTab(sp.tab, TABS);
  const [d, counts, g] = await Promise.all([ospa(parseBasis(sp.basis)), openCounts(), goalsFor(PLACE)]);
  const tabs = <Tabs base={BASE} active={tab} tabs={[
    { key: 'overview', label: 'סקירה' },
    { key: 'tasks', label: 'משימות', count: counts['business/head-spa-israel']?.open },
    { key: 'goals', label: 'יעדים', count: g.goals.filter(x => x.status === 'active').length },
  ]} />;

  if (tab !== 'overview') {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-semibold">הד ספא ישראל</h1>
          <p className="text-sm text-muted">עסקים · כל הסניפים</p>
        </div>
        {tabs}
        {tab === 'tasks' && <TaskBoard place={PLACE} path={BASE} title="משימות הד ספא ישראל" />}
        {tab === 'goals' && <GoalsPanel place={PLACE} path={BASE} title="יעדי הד ספא ישראל" />}
      </div>
    );
  }
  return (
    <OspaView d={d} base={BASE} title="הד ספא ישראל" subtitle="עסקים · כל הסניפים" tabs={tabs}>
      <BranchCards d={d} counts={counts} />
    </OspaView>
  );
}
