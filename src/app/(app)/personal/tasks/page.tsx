import { PERSONAL_LISTS, openCounts } from '@/server/entries';
import { Tabs, pickTab } from '@/components/shell/tabs';
import { TaskBoard } from '@/components/work/task-board';
import { PageHeader } from '@/components/shell/page-header';
import { PersonalBadge, PersonalNav } from '../area-nav';

export const metadata = { title: 'משימות אישיות — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const BASE = '/personal/tasks';
// "בית" lives in the household workspace now (/household/tasks)
const LISTS = PERSONAL_LISTS.filter(l => l.key !== 'home');
const TABS = ['all', ...LISTS.map(l => l.key)] as const;

// Personal and study tasks. "All" also shows the read-only vault tasks.
export default async function PersonalTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tab = pickTab((await searchParams).tab, TABS);
  const counts = await openCounts();
  const list = tab === 'all' ? null : tab;
  const label = LISTS.find(l => l.key === list)?.label;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="משימות" subtitle="אישי ולימודים" status={<PersonalBadge />} tabs={<PersonalNav />} />
      <Tabs base={BASE} active={tab} tabs={[
        { key: 'all', label: 'הכל', count: counts.personal?.open },
        ...LISTS.map(l => ({ key: l.key, label: l.label, count: counts[`personal:${l.key}`]?.open })),
      ]} />
      <TaskBoard place={{ domain: 'personal', branch: null, location: null }} category={list} path={BASE}
        title={label ? `משימות ${label}` : 'כל המשימות האישיות'} withOwner showContext={!list} />
    </div>
  );
}
