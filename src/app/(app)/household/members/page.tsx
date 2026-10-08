import { PageHeader } from '@/components/shell/page-header';
import { PrivacyBoundary } from '@/components/workspace/privacy-boundary';
import { MembersPanel } from '@/components/workspace/members-panel';
import { HouseholdBadge, HouseholdNav } from '../area-nav';
import { householdContext } from '../context';

export const metadata = { title: 'חברי משק הבית — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

// Who shares the household, in what role, and how to invite someone. What each member's
// membership exposes is spelled out next to the list (the privacy boundary).
export default async function HouseholdMembersPage() {
  const { u, w, members } = await householdContext();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="חברים" subtitle={<>מי שותף ב<bdi>{w.name}</bdi> ומה כל אחד רואה</>}
        status={<HouseholdBadge members={members.length} />} tabs={<HouseholdNav />} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
        <MembersPanel w={w} u={u} members={members} />
        <div><PrivacyBoundary /></div>
      </div>
    </div>
  );
}
