'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { addTask, type ActionResult } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Field, PlaceInputs, inputClass } from './fields';

type Opt = { key: string; label: string };

// Quick add: title + Enter. "פרטים" opens priority, due date, list and owner.
export function TaskForm({ domain, branch, location, path, lists, defaultList, owners }: {
  domain: string; branch?: string | null; location?: string | null; path: string;
  lists?: readonly Opt[]; defaultList?: string | null; owners?: readonly { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addTask, null);
  const [more, setMore] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) form.current?.reset(); }, [state]);
  const id = `${domain}-${branch ?? ''}-${location ?? ''}`;

  return (
    <form ref={form} action={action} className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2/40 p-3">
      <PlaceInputs domain={domain} branch={branch} location={location} path={path} />
      <div className="flex gap-2">
        <label htmlFor={`t-${id}`} className="sr-only">משימה חדשה</label>
        <input id={`t-${id}`} name="title" required maxLength={300} placeholder="משימה חדשה…" className={inputClass} />
        <Button type="submit" variant="primary" disabled={pending} aria-label="הוסף משימה"><Plus className="size-4" aria-hidden />הוסף</Button>
      </div>
      <button type="button" onClick={() => setMore(m => !m)} className="self-start text-xs font-medium text-accent hover:underline" aria-expanded={more}>
        {more ? 'פחות פרטים' : 'פרטים: עדיפות, תאריך, רשימה'}
      </button>
      <div className={more ? 'grid grid-cols-2 gap-3 sm:grid-cols-4' : 'hidden'}>
        <Field label="עדיפות" htmlFor={`p-${id}`}>
          <select id={`p-${id}`} name="priority" defaultValue="2" className={inputClass}>
            <option value="1">גבוהה</option><option value="2">רגילה</option><option value="3">נמוכה</option>
          </select>
        </Field>
        <Field label="עד תאריך" htmlFor={`d-${id}`}>
          <input id={`d-${id}`} name="due" type="date" className={inputClass} />
        </Field>
        {lists && (
          <Field label="רשימה" htmlFor={`l-${id}`}>
            <select key={defaultList ?? ''} id={`l-${id}`} name="list" defaultValue={defaultList ?? lists[0].key} className={inputClass}>
              {lists.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          </Field>
        )}
        {owners && (
          <Field label="של מי" htmlFor={`o-${id}`}>
            <select id={`o-${id}`} name="owner" defaultValue="avihu" className={inputClass}>
              {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="הערות" htmlFor={`n-${id}`} className="col-span-2 sm:col-span-4">
          <input id={`n-${id}`} name="notes" maxLength={4000} className={inputClass} />
        </Field>
      </div>
      {state && !state.ok && <p role="alert" className="text-xs text-critical-ink">{state.error}</p>}
    </form>
  );
}
