import { HOUSEHOLD } from '@/lib/workspaces';
import { PageHeader } from '@/components/shell/page-header';
import { ContributionPlanner } from '@/components/workspace/contribution-planner';
import { PrivacyBoundary } from '@/components/workspace/privacy-boundary';
import { HouseholdBadge, HouseholdNav } from '../area-nav';

export const metadata = { title: 'תקציב הבית — דשבורד גורזד' };

export default function HouseholdBudgetPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="תקציב" subtitle="התקציב של הבית הוא סכום ההעברות שכל חבר מגדיר" status={<HouseholdBadge />} tabs={<HouseholdNav />} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
        <ContributionPlanner members={HOUSEHOLD.members.map(m => ({ id: m.id, name: m.name }))} />
        <PrivacyBoundary />
      </div>
    </div>
  );
}
