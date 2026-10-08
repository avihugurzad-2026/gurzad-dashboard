import { GoalsPanel } from '@/components/work/goals-panel';
import { PageHeader } from '@/components/shell/page-header';
import { PersonalNav } from '../area-nav';

export const metadata = { title: 'יעדים פיננסיים — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

export default function PersonalGoalsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="יעדים פיננסיים" subtitle="חיסכון, החזר חובות, קרן חירום וכל יעד עם מספר ותאריך" tabs={<PersonalNav />} />
      <GoalsPanel place={{ domain: 'personal', branch: null, location: null }} path="/personal/goals"
        title="יעדים" defaultUnit="ils" withOwner />
    </div>
  );
}
