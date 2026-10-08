import { TaskBoard } from '@/components/work/task-board';
import { PageHeader } from '@/components/shell/page-header';
import { VenturesBadge, VenturesNav } from '../area-nav';

export const metadata = { title: 'משימות יזמות — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

export default function VenturesTasksPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="משימות" subtitle="כל המשימות של היזמות, מכל התחומים" status={<VenturesBadge />} tabs={<VenturesNav />} />
      <TaskBoard place={{ domain: 'ventures', branch: null, location: null }} path="/ventures/tasks" title="כל משימות היזמות" showContext />
    </div>
  );
}
