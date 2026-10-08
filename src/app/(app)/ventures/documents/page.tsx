import { requirePlace } from '@/server/auth';
import { PageHeader } from '@/components/shell/page-header';
import { WorkspaceDocuments } from '@/components/workspace/workspace-documents';
import { VenturesBadge, VenturesNav } from '../area-nav';

export const metadata = { title: 'מסמכי יזמות — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

export default async function VenturesDocumentsPage() {
  const u = await requirePlace({ domain: 'ventures' });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="מסמכים" subtitle="חוזים, הסכמי הלוואה ומסמכים משפטיים של היזמות" status={<VenturesBadge />} tabs={<VenturesNav />} />
      <WorkspaceDocuments u={u} place={{ domain: 'ventures', branch: null, location: null }} path="/ventures/documents" title="מסמכי יזמות" />
    </div>
  );
}
