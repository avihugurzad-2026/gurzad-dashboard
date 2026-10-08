import { GoalsPanel } from '@/components/work/goals-panel';
import { PageHeader } from '@/components/shell/page-header';
import { PersonalBadge, PersonalNav } from '../area-nav';

export const metadata = { title: 'יעדים אישיים — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

export default function PersonalGoalsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="יעדים" subtitle="חיסכון, החזר חובות, קרן חירום וכל יעד אישי עם מספר ותאריך" status={<PersonalBadge />} tabs={<PersonalNav />} />
      <GoalsPanel place={{ domain: 'personal', branch: null, location: null }} path="/personal/goals"
        title="יעדים" defaultUnit="ils" withOwner />
    </div>
  );
}
