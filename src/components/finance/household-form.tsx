'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { addTransaction, type FinanceResult } from '@/app/finance-actions';
import { Button } from '@/components/ui/button';
import { Field, inputClass } from '@/components/work/fields';
import { SPLIT_PEOPLE, categoriesOf, type Direction } from '@/lib/finance';
import { cn } from '@/lib/utils';

// The shared household book: a personal, shared transaction (no VAT), optionally split 50/50
export function HouseholdForm({ path, today }: { path: string; today: string }) {
  const [state, action, pending] = useActionState<FinanceResult | null, FormData>(addTransaction, null);
  const [direction, setDirection] = useState<Direction>('expense');
  const [split, setSplit] = useState(true);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) form.current?.reset(); }, [state]);
  const cats = categoriesOf(direction, 'personal');

  return (
    <form ref={form} action={action} className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-2/40 p-3 sm:grid-cols-6">
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="classification" value="personal" />
      <input type="hidden" name="place" value="personal||" />
      <input type="hidden" name="scope" value="shared" />
      <input type="hidden" name="document_type" value="none" />
      <div role="group" aria-label="סוג" className="col-span-2 inline-flex rounded-lg border border-line-strong p-0.5 text-sm sm:col-span-6 sm:w-fit">
        {(['expense', 'income'] as const).map(k => (
          <button key={k} type="button" onClick={() => setDirection(k)} aria-pressed={direction === k}
            className={cn('rounded-md px-4 py-1.5', direction === k ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2')}>
            {k === 'expense' ? 'הוצאה' : 'הכנסה'}
          </button>
        ))}
      </div>
      <Field label="סכום (₪)" htmlFor="h-amount">
        <input id="h-amount" name="amount" required inputMode="decimal" className={inputClass} />
      </Field>
      <Field label="קטגוריה" htmlFor="h-cat" className="sm:col-span-2">
        <select id="h-cat" name="category" key={direction} defaultValue={cats[0]?.id} className={inputClass}>
          {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="תאריך" htmlFor="h-date">
        <input id="h-date" name="occurred_on" type="date" required defaultValue={today} className={inputClass} />
      </Field>
      <div className="col-span-2 flex flex-col justify-end gap-1">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="split" checked={split} onChange={e => setSplit(e.target.checked)} className="size-4" />
          חצי-חצי ({SPLIT_PEOPLE.map(p => p.name).join(' ו')})
        </label>
        {split && SPLIT_PEOPLE.map(p => <input key={p.id} type="hidden" name={`share_${p.id}`} value="50" />)}
      </div>
      <Field label="הערה" htmlFor="h-note" className="col-span-2 sm:col-span-5">
        <input id="h-note" name="description" maxLength={500} className={inputClass} />
      </Field>
      <div className="col-span-2 flex items-end sm:col-span-1">
        <Button type="submit" variant="primary" disabled={pending} className="w-full"><Plus className="size-4" aria-hidden />שמור</Button>
      </div>
      {state && !state.ok && <p role="alert" className="col-span-full text-xs text-critical-ink">{state.error}</p>}
    </form>
  );
}
