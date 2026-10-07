import { GoalsPanel } from '@/components/work/goals-panel';

export const metadata = { title: 'יעדים פיננסיים — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

export default function PersonalGoalsPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page font-bold">יעדים פיננסיים</h1>
        <p className="text-sm text-muted">אישי · חיסכון, החזר חובות, קרן חירום וכל יעד עם מספר ותאריך</p>
      </div>
      <GoalsPanel place={{ domain: 'personal', branch: null, location: null }} path="/personal/goals"
        title="יעדים" defaultUnit="ils" withOwner />
    </div>
  );
}
