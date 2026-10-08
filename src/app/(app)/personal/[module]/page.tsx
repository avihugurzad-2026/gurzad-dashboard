import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth';
import { personalWorkspace } from '@/server/workspaces';
import { PERSONAL_MODULES, moduleOf } from '@/lib/workspaces';
import { PageHeader } from '@/components/shell/page-header';
import { ModulePlaceholder } from '@/components/workspace/workspace-ui';
import { WorkspaceDocuments } from '@/components/workspace/workspace-documents';
import { PersonalBadge, PersonalNav } from '../area-nav';

export const dynamic = 'force-dynamic';

// Personal modules without a page of their own: documents (real, the user's own) and placeholders.
// Money has its own page (/personal/money), so it is not handled here.
const SUBTITLE: Record<string, string> = {
  documents: 'המסמכים האישיים שלך. רק אתה רואה אותם',
  investments: 'ההשקעות האישיות שלך, בנפרד מהיזמות',
  info: 'פרטים ומידע שימושי, רק בשבילך',
};
const ACTIONS: Record<string, { href: string; label: string }> = {
  investments: { href: '/personal/money', label: 'לפיננסים האישיים' },
  info: { href: '/personal/documents', label: 'למסמכים האישיים' },
};

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }) {
  const m = moduleOf(PERSONAL_MODULES, (await params).module);
  return { title: `${m?.label ?? 'אישי'} — דשבורד גורזד` };
}

export default async function PersonalModulePage({ params }: { params: Promise<{ module: string }> }) {
  const key = (await params).module;
  const m = moduleOf(PERSONAL_MODULES, key);
  if (!m || !SUBTITLE[key]) notFound();
  const u = await requireUser();
  const me = await personalWorkspace(u);
  const place = { domain: 'personal', branch: null, location: null } as const;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={m.label} subtitle={SUBTITLE[key]} status={<PersonalBadge />} tabs={<PersonalNav />} />
      {key === 'documents'
        ? <WorkspaceDocuments u={u} place={place} path="/personal/documents" title="המסמכים שלי" />
        : <ModulePlaceholder wsName={me?.name ?? 'האזור האישי'} module={m} action={ACTIONS[key]} />}
    </div>
  );
}
