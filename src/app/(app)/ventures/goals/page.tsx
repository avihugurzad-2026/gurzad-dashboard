import { GoalsPanel } from '@/components/work/goals-panel';
import { PageHeader } from '@/components/shell/page-header';
import { VenturesBadge, VenturesNav } from '../area-nav';

export const metadata = { title: 'יעדי יזמות — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

export default function VenturesGoalsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="יעדים" subtitle="יעדים של היזמות כולה" status={<VenturesBadge />} tabs={<VenturesNav />} />
      <GoalsPanel place={{ domain: 'ventures', branch: null, location: null }} path="/ventures/goals" title="יעדי יזמות" />
    </div>
  );
}
