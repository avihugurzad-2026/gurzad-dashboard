import { notFound } from 'next/navigation';
import { HOUSEHOLD, moduleOf } from '@/lib/workspaces';
import { PageHeader } from '@/components/shell/page-header';
import { ModulePlaceholder } from '@/components/workspace/workspace-ui';
import { HouseholdBadge, HouseholdNav } from '../area-nav';

export const dynamic = 'force-dynamic';

// Household modules that are part of the structure but have no data source yet (UI stage)
const SUBTITLE: Record<string, string> = {
  fixed: 'מה הבית משלם כל חודש',
  bills: 'חשבונות לתשלום ומה כבר שולם',
  documents: 'המסמכים המשותפים של הבית',
  savings: 'יעדים שהבית חוסך אליהם ביחד',
};

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }) {
  const m = moduleOf(HOUSEHOLD, (await params).module);
  return { title: `${m?.label ?? 'הבית שלנו'} — דשבורד גורזד` };
}

export default async function HouseholdModulePage({ params }: { params: Promise<{ module: string }> }) {
  const key = (await params).module;
  const m = moduleOf(HOUSEHOLD, key);
  if (!m || m.ready || !SUBTITLE[key]) notFound();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={m.label} subtitle={SUBTITLE[key]} status={<HouseholdBadge />} tabs={<HouseholdNav />} />
      <ModulePlaceholder ws={HOUSEHOLD} module={m} />
    </div>
  );
}
