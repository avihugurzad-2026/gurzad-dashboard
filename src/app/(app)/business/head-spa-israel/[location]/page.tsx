import { notFound } from 'next/navigation';
import { PlugZap } from 'lucide-react';
import { ospa, parseBasis } from '@/server/revenue';
import { goalsFor, openCounts } from '@/server/entries';
import { OspaView } from '@/components/ospa/ospa-view';
import { Tabs, pickTab } from '@/components/shell/tabs';
import { TaskBoard } from '@/components/work/task-board';
import { GoalsPanel } from '@/components/work/goals-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';

export const dynamic = 'force-dynamic';

const TABS = ['overview', 'tasks', 'goals'] as const;

export async function generateMetadata({ params }: { params: Promise<{ location: string }> }) {
  const { location } = await params;
  return { title: `סניף ${location === 'modiin' ? 'מודיעין' : location === 'jerusalem' ? 'ירושלים' : ''} — הד ספא ישראל` };
}

// One branch: the same screen as every other branch, with only this branch's numbers
export default async function BranchPage({ params, searchParams }: {
  params: Promise<{ location: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ location }, sp] = await Promise.all([params, searchParams]);
  if (!/^[a-z0-9-]{1,40}$/.test(location)) notFound();
  const tab = pickTab(sp.tab, TABS);
  const d = await ospa(parseBasis(sp.basis), location);
  const loc = d.locations[0];
  if (!loc) notFound();

  const base = `/business/head-spa-israel/${location}`;
  const place = { domain: 'business', branch: 'head-spa-israel', location } as const;
  const [counts, g] = await Promise.all([openCounts(), goalsFor(place)]);
  const title = `סניף ${loc.name_he}`;
  const subtitle = 'עסקים · הד ספא ישראל';
  const tabs = <Tabs base={base} active={tab} tabs={[
    { key: 'overview', label: 'סקירה' },
    { key: 'tasks', label: 'משימות', count: counts[`business/head-spa-israel/${location}`]?.open },
    { key: 'goals', label: 'יעדים', count: g.goals.filter(x => x.status === 'active').length },
  ]} />;

  if (tab === 'overview' && loc.connected) return <OspaView d={d} base={base} title={title} subtitle={subtitle} tabs={tabs} />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted">{subtitle}</p>
      </div>
      {tabs}
      {tab === 'overview' && (
        <Card><CardContent className="pt-5">
          <Empty icon={<PlugZap className="size-6" />} title="הסניף עוד לא פעיל">
            כשהסניף ייפתח ויקבל חשבון Buyz משלו, יופיעו כאן אותם נתונים כמו בסניף מודיעין: הכנסה חודשית, עסקאות, אמצעי תשלום ומכירות.
            בינתיים אפשר לנהל כאן משימות ויעדים להקמת הסניף.
          </Empty>
        </CardContent></Card>
      )}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <TaskBoard place={place} path={base} title={`משימות ${title}`} />
          <GoalsPanel place={place} path={base} title={`יעדי ${title}`} />
        </div>
      )}
      {tab === 'tasks' && <TaskBoard place={place} path={base} title={`משימות ${title}`} />}
      {tab === 'goals' && <GoalsPanel place={place} path={base} title={`יעדי ${title}`} />}
    </div>
  );
}
