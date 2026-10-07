'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { addMoney, type ActionResult } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Field, inputClass } from './fields';

const DEFAULT_CATEGORIES = {
  expense: ['שכירות / משכנתא', 'סופר', 'חשבונות', 'רכב ודלק', 'ילדים', 'בריאות', 'לימודים', 'בילויים', 'ביגוד', 'מנויים', 'אחר'],
  income: ['משכורת', 'משיכה מהעסק', 'שכירות', 'החזר', 'אחר'],
};

export function MoneyForm({ path, today, categories, owners }: {
  path: string; today: string; categories: string[]; owners: readonly { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addMoney, null);
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) form.current?.reset(); }, [state]);
  const options = [...new Set([...DEFAULT_CATEGORIES[kind], ...categories])];

  return (
    <form ref={form} action={action} className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-2/40 p-3 sm:grid-cols-6">
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="kind" value={kind} />
      <div role="group" aria-label="סוג" className="col-span-2 inline-flex rounded-lg border border-line-strong p-0.5 text-sm sm:col-span-6 sm:w-fit">
        {(['expense', 'income'] as const).map(k => (
          <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
            className={cn('rounded-md px-4 py-1.5', kind === k ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2')}>
            {k === 'expense' ? 'הוצאה' : 'הכנסה'}
          </button>
        ))}
      </div>
      <Field label="סכום (₪)" htmlFor="m-amount">
        <input id="m-amount" name="amount" required inputMode="decimal" className={inputClass} />
      </Field>
      <Field label="קטגוריה" htmlFor="m-cat" className="sm:col-span-2">
        <input id="m-cat" name="category" required list="m-cats" maxLength={60} placeholder="בחר או כתוב" className={inputClass} />
        <datalist id="m-cats">{options.map(c => <option key={c} value={c} />)}</datalist>
      </Field>
      <Field label="תאריך" htmlFor="m-date">
        <input id="m-date" name="occurred_on" type="date" required defaultValue={today} className={inputClass} />
      </Field>
      <Field label="של מי" htmlFor="m-owner">
        <select id="m-owner" name="owner" defaultValue="avihu" className={inputClass}>
          {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </Field>
      <Field label="הערה" htmlFor="m-note" className="col-span-2 sm:col-span-5">
        <input id="m-note" name="note" maxLength={500} className={inputClass} />
      </Field>
      <div className="col-span-2 flex items-end sm:col-span-1">
        <Button type="submit" variant="primary" disabled={pending} className="w-full"><Plus className="size-4" aria-hidden />שמור</Button>
      </div>
      {state && !state.ok && <p role="alert" className="col-span-full text-xs text-critical-ink">{state.error}</p>}
    </form>
  );
}
