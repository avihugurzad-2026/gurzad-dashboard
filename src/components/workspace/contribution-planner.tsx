'use client';
import { useState } from 'react';
import { Info } from 'lucide-react';
import { ils } from '@/lib/format';
import money from '@domain/money';
import { inputClass } from '@/components/work/fields';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Each member decides how much they put into the household each month. The household budget is
// the sum of those transfers; a member's income never appears here. UI stage: nothing is saved.
export function ContributionPlanner({ members }: { members: { id: string; name: string }[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const amount = (id: string) => {
    return money.parseAmount(values[id] ?? '');
  };
  const filled = members.map(m => amount(m.id)).filter((n): n is number => n !== null);
  const total = filled.length ? filled.reduce((a, b) => a + b, 0) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-1">
          <CardTitle>העברות לבית</CardTitle>
          <p className="text-sm text-muted">כל חבר מגדיר כמה הוא מעביר לבית כל חודש</p>
        </div>
        <Badge tone="warning">טיוטה · לא נשמר</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ul className="flex flex-col divide-y divide-[color:var(--border)]">
          {members.map(m => (
            <li key={m.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <label htmlFor={`contrib-${m.id}`} className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-ink" aria-hidden>{m.name.slice(0, 1)}</span>
                <span className="flex flex-col">
                  <span className="text-body font-medium text-ink">{m.name}</span>
                  <span className="text-xs text-muted">העברה חודשית לבית</span>
                </span>
              </label>
              <div className="relative sm:w-56">
                <input id={`contrib-${m.id}`} inputMode="decimal" dir="ltr" placeholder="0" autoComplete="off"
                  value={values[m.id] ?? ''} onChange={e => setValues(v => ({ ...v, [m.id]: e.target.value }))}
                  className={`${inputClass} pl-9 text-right tabular`} />
                <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-sm text-muted" aria-hidden>₪</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-1 rounded-xl bg-surface-2 px-5 py-4">
          <p className="text-sm font-medium text-ink-2">תקציב זמין לבית בחודש</p>
          {total === null ? <p className="text-body text-muted">יופיע אחרי שחבר יגדיר העברה</p>
            : <p className="text-kpi font-bold text-ink tabular"><bdi className="amount">{ils(total)}</bdi></p>}
        </div>
        <p className="flex items-start gap-2 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          ההכנסה של כל חבר נשארת באזור האישי שלו. הבית רואה רק את ההעברה. שמירה תגיע בשלב בניית מסד הנתונים.
        </p>
      </CardContent>
    </Card>
  );
}
