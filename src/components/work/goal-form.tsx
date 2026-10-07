'use client';
import { useActionState, useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import { addGoal, type ActionResult } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Field, PlaceInputs, inputClass } from './fields';

export function GoalForm({ domain, branch, location, path, defaultUnit = 'ils', owners }: {
  domain: string; branch?: string | null; location?: string | null; path: string;
  defaultUnit?: 'ils' | 'count' | 'pct'; owners?: readonly { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addGoal, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) form.current?.reset(); }, [state]);
  const id = `g-${domain}-${branch ?? ''}-${location ?? ''}`;

  return (
    <div className="@container"><form ref={form} action={action} className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-2/40 p-3 @2xl:grid-cols-6">
      <PlaceInputs domain={domain} branch={branch} location={location} path={path} />
      <Field label="יעד" htmlFor={`${id}-t`} className="col-span-2 @2xl:col-span-3">
        <input id={`${id}-t`} name="title" required maxLength={300} placeholder="למשל: הכנסה חודשית 150,000 ₪" className={inputClass} />
      </Field>
      <Field label="יחידה" htmlFor={`${id}-u`}>
        <select id={`${id}-u`} name="unit" defaultValue={defaultUnit} className={inputClass}>
          <option value="ils">₪</option><option value="count">מספר</option><option value="pct">%</option>
        </select>
      </Field>
      <Field label="יעד מספרי" htmlFor={`${id}-n`}>
        <input id={`${id}-n`} name="target" inputMode="decimal" className={inputClass} />
      </Field>
      <Field label="עד תאריך" htmlFor={`${id}-d`}>
        <input id={`${id}-d`} name="due" type="date" className={inputClass} />
      </Field>
      <Field label="מצב היום (לא חובה)" htmlFor={`${id}-c`}>
        <input id={`${id}-c`} name="current" inputMode="decimal" className={inputClass} />
      </Field>
      {owners && (
        <Field label="של מי" htmlFor={`${id}-o`}>
          <select id={`${id}-o`} name="owner" defaultValue="avihu" className={inputClass}>
            {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
      )}
      <div className="col-span-2 flex items-end @2xl:col-span-1">
        <Button type="submit" variant="primary" disabled={pending} className="w-full"><Plus className="size-4" aria-hidden />הוסף יעד</Button>
      </div>
      {state && !state.ok && <p role="alert" className="col-span-full text-xs text-critical-ink">{state.error}</p>}
    </form></div>
  );
}
