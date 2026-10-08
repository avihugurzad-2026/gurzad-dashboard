import { notFound } from 'next/navigation';
import { PERSONAL, moduleOf } from '@/lib/workspaces';
import { encodePlace } from '@/lib/places';
import { PageHeader } from '@/components/shell/page-header';
import { ModulePlaceholder } from '@/components/workspace/workspace-ui';
import { PersonalBadge, PersonalNav } from '../area-nav';

export const dynamic = 'force-dynamic';

// Personal modules that are part of the structure but have no data source yet (UI stage)
const SUBTITLE: Record<string, string> = {
  money: 'כל ההכנסות וההוצאות האישיות שלך, חשבונות, כרטיסים וחסכונות',
  documents: 'המסמכים האישיים שלך',
  investments: 'ההשקעות האישיות שלך, בנפרד מהיזמות',
  info: 'פרטים ומידע שימושי, רק בשבילך',
};
const ACTIONS: Record<string, { href: string; label: string }> = {
  documents: { href: `/documents?place=${encodeURIComponent(encodePlace({ domain: 'personal', branch: null, location: null }))}`, label: 'למסמכים הקיימים' },
};

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }) {
  const m = moduleOf(PERSONAL, (await params).module);
  return { title: `${m?.label ?? 'אישי'} — דשבורד גורזד` };
}

export default async function PersonalModulePage({ params }: { params: Promise<{ module: string }> }) {
  const key = (await params).module;
  const m = moduleOf(PERSONAL, key);
  if (!m || m.ready || !SUBTITLE[key]) notFound();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={m.label} subtitle={SUBTITLE[key]} status={<PersonalBadge />} tabs={<PersonalNav />} />
      <ModulePlaceholder ws={PERSONAL} module={m} action={ACTIONS[key]}
        note={key === 'money' ? 'הכנסה אישית נשארת כאן. היא לא נכנסת לבית אוטומטית: לבית עוברת רק ההעברה שתגדיר בתקציב של הבית.' : undefined} />
    </div>
  );
}
