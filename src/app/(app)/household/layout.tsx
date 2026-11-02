import { Lock, Mail, Sofa } from 'lucide-react';
import { requireUser } from '@/server/auth';
import { currentHousehold, myWorkspaces } from '@/server/workspaces';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { CreateWorkspaceForm, HouseholdSwitcher } from '@/components/workspace/workspace-forms';

// Every /household page is about the user's current household (cookie, else the first one).
// No household yet: one screen that explains what a household is and creates one.
export default async function HouseholdLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const [current, mine] = await Promise.all([currentHousehold(u), myWorkspaces(u)]);
  if (!current) return <NoHousehold />;
  const households = mine.filter(w => w.kind === 'household');
  return (
    <div className="flex flex-col gap-4">
      {households.length > 1 && (
        <div className="flex justify-end">
          <HouseholdSwitcher current={current.id} households={households.map(h => ({ id: h.id, name: h.name }))} />
        </div>
      )}
      {children}
    </div>
  );
}

function NoHousehold() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="משק בית" subtitle="אזור משותף למשפחה" />
      <Card className="mx-auto w-full max-w-xl">
        <CardContent className="flex flex-col gap-6 pt-6 sm:pt-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden><Sofa className="size-5" /></span>
            <h2 className="text-section font-semibold text-ink">עוד אין לך משק בית</h2>
            <p className="max-w-md text-body text-muted">
              משק בית הוא אזור משותף למשפחה: משימות הבית, הוצאות משותפות, תקציב ויעדי חיסכון.
              כל חבר רואה רק את מה שמשותף.
            </p>
            <p className="flex max-w-md items-start gap-2 text-sm text-muted">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              האזור האישי של כל חבר נשאר פרטי: ההכנסות, החשבונות והמסמכים האישיים לא עוברים לבית.
            </p>
          </div>
          <CreateWorkspaceForm kind="household" />
          <p className="flex items-start gap-2 border-t border-line pt-4 text-sm text-muted">
            <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
            מישהו הזמין אותך למשק בית קיים? פתח את הקישור מההזמנה שקיבלת, ותצטרף אליו.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
