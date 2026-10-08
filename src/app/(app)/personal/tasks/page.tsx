import { PERSONAL_LISTS, openCounts } from '@/server/entries';
import { Tabs, pickTab } from '@/components/shell/tabs';
import { TaskBoard } from '@/components/work/task-board';
import { PageHeader } from '@/components/shell/page-header';
import { PersonalNav } from '../area-nav';

export const metadata = { title: 'משימות אישיות — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const BASE = '/personal/tasks';
const TABS = ['all', ...PERSONAL_LISTS.map(l => l.key)] as const;

// Home, personal and study tasks, for avihu and Eden. "All" also shows the read-only vault tasks.
export default async function PersonalTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tab = pickTab((await searchParams).tab, TABS);
  const counts = await openCounts();
  const list = tab === 'all' ? null : tab;
  const label = PERSONAL_LISTS.find(l => l.key === list)?.label;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="משימות" subtitle="בית, אישי ולימודים" tabs={<PersonalNav />} />
      <Tabs base={BASE} active={tab} tabs={[
        { key: 'all', label: 'הכל', count: counts.personal?.open },
        ...PERSONAL_LISTS.map(l => ({ key: l.key, label: l.label, count: counts[`personal:${l.key}`]?.open })),
      ]} />
      <TaskBoard place={{ domain: 'personal', branch: null, location: null }} category={list} path={BASE}
        title={label ? `משימות ${label}` : 'כל המשימות האישיות'} withOwner showContext={!list} />
    </div>
  );
}
