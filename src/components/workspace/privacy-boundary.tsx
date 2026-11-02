import { Check, EyeOff } from 'lucide-react';
import { HOUSEHOLD_NEVER_SEES, HOUSEHOLD_SEES } from '@/lib/workspaces';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// The line between a member's personal workspace and the household: what crosses it and what never does
export function PrivacyBoundary() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>גבול הפרטיות</CardTitle>
        <span className="text-sm text-muted">מה הבית רואה מכל חבר</span>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-good-ink">הבית רואה</p>
          <ul className="flex flex-col gap-2.5">
            {HOUSEHOLD_SEES.map(s => (
              <li key={s} className="flex items-start gap-2 text-body text-ink-2"><Check className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />{s}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-ink-2">הבית לא רואה</p>
          <ul className="flex flex-col gap-2.5">
            {HOUSEHOLD_NEVER_SEES.map(s => (
              <li key={s} className="flex items-start gap-2 text-body text-ink-2"><EyeOff className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />{s}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
