import { notFound } from 'next/navigation';
import { HOUSEHOLD_MODULES, moduleOf } from '@/lib/workspaces';
import { PageHeader } from '@/components/shell/page-header';
import { ModulePlaceholder } from '@/components/workspace/workspace-ui';
import { WorkspaceDocuments } from '@/components/workspace/workspace-documents';
import { HouseholdBadge, HouseholdNav } from '../area-nav';
import { householdContext } from '../context';

export const dynamic = 'force-dynamic';

// Household modules without a page of their own: documents (real, scoped to this household) and a
// placeholder for any module whose page does not exist yet. Pages with their own folder
// (finance, budget, tasks, members …) take precedence over this route.
const SUBTITLE: Record<string, string> = {
  documents: 'המסמכים המשותפים של הבית: חוזים, חשבונות, ביטוחים',
  fixed: 'מה הבית משלם כל חודש',
  bills: 'חשבונות לתשלום ומה כבר שולם',
  savings: 'יעדים שהבית חוסך אליהם ביחד',
};

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }) {
  const m = moduleOf(HOUSEHOLD_MODULES, (await params).module);
  return { title: `${m?.label ?? 'משק בית'} — דשבורד גורזד` };
}

export default async function HouseholdModulePage({ params }: { params: Promise<{ module: string }> }) {
  const key = (await params).module;
  const m = moduleOf(HOUSEHOLD_MODULES, key);
  if (!m || !SUBTITLE[key]) notFound();
  const { u, w, members, place } = await householdContext();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={m.label} subtitle={SUBTITLE[key]} status={<HouseholdBadge members={members.length} />} tabs={<HouseholdNav />} />
      {key === 'documents'
        ? <WorkspaceDocuments u={u} place={place} path="/household/documents" title={`מסמכי ${w.name}`} />
        : <ModulePlaceholder wsName={w.name} module={m} action={{ href: '/household/finance', label: 'לפיננסים המשותפים' }} />}
    </div>
  );
}
