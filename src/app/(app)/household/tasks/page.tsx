import { TaskBoard } from '@/components/work/task-board';
import { PageHeader } from '@/components/shell/page-header';
import { HouseholdBadge, HouseholdNav } from '../area-nav';

export const metadata = { title: 'משימות הבית — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

// The household's tasks are today's "בית" list
export default function HouseholdTasksPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="משימות הבית" subtitle="מה צריך לעשות בבית, לאביהו ולעדן" status={<HouseholdBadge />} tabs={<HouseholdNav />} />
      <TaskBoard place={{ domain: 'personal', branch: null, location: null }} category="home" path="/household/tasks"
        title="משימות הבית" withOwner />
    </div>
  );
}
