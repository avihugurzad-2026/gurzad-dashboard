'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { addTransaction, type FinanceResult } from '@/app/finance-actions';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Field, inputClass, selectClass } from '@/components/work/fields';
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
    <form ref={form} action={action} className="grid grid-cols-2 gap-4 rounded-lg border border-line bg-surface-2/40 p-4 sm:grid-cols-6">
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="classification" value="personal" />
      <input type="hidden" name="place" value="personal||" />
      <input type="hidden" name="scope" value="shared" />
      <input type="hidden" name="document_type" value="none" />
      <div role="group" aria-label="סוג" className="col-span-2 inline-flex rounded-lg border border-line-strong bg-surface p-0.5 text-sm sm:col-span-6 sm:w-fit">
        {(['expense', 'income'] as const).map(k => (
          <button key={k} type="button" onClick={() => setDirection(k)} aria-pressed={direction === k}
            className={cn('h-8 rounded-md px-4 font-medium transition-colors', direction === k ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-2')}>
            {k === 'expense' ? 'הוצאה' : 'הכנסה'}
          </button>
        ))}
      </div>
      <Field label="סכום (₪)" htmlFor="h-amount">
        <input id="h-amount" name="amount" required inputMode="decimal" className={inputClass} />
      </Field>
      <Field label="קטגוריה" htmlFor="h-cat" className="sm:col-span-2">
        <select id="h-cat" name="category" key={direction} defaultValue={cats[0]?.id} className={selectClass}>
          {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="תאריך" htmlFor="h-date">
        <DateField id="h-date" name="occurred_on" required defaultValue={today} />
      </Field>
      <div className="col-span-2 flex flex-col justify-end gap-1 pb-2.5">
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="split" checked={split} onChange={e => setSplit(e.target.checked)} className="size-4" />
          חצי-חצי ({SPLIT_PEOPLE.map(p => p.name).join(' ו')})
        </label>
        {split && SPLIT_PEOPLE.map(p => <input key={p.id} type="hidden" name={`share_${p.id}`} value="50" />)}
      </div>
      <Field label="הערה" htmlFor="h-note" className="col-span-2 sm:col-span-5">
        <input id="h-note" name="description" maxLength={500} className={inputClass} />
      </Field>
      <div className="col-span-2 flex items-end sm:col-span-1">
        <Button type="submit" variant="primary" disabled={pending} className="w-full"><Plus aria-hidden />שמור</Button>
      </div>
      {state && !state.ok && <p role="alert" className="col-span-full text-sm text-critical-ink">{state.error}</p>}
    </form>
  );
}
