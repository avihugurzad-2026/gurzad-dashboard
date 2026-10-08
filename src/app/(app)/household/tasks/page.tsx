import { TaskBoard } from '@/components/work/task-board';
import { PageHeader } from '@/components/shell/page-header';
import { HouseholdBadge, HouseholdNav } from '../area-nav';
import { householdContext } from '../context';

export const metadata = { title: 'משימות הבית — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

// The household's shared task list: every member sees and updates it
export default async function HouseholdTasksPage() {
  const { w, members, place } = await householdContext();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="משימות הבית" subtitle={<>מה צריך לעשות ב<bdi>{w.name}</bdi>, ומי עושה מה</>}
        status={<HouseholdBadge members={members.length} />} tabs={<HouseholdNav />} />
      <TaskBoard place={place} path="/household/tasks" title="משימות הבית" withOwner />
    </div>
  );
}
