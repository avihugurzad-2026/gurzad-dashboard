'use client';
import { useActionState, useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Inbox, Plus } from 'lucide-react';
import { addTask, type ActionResult } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { categoriesFor, decodePlace, encodePlace, placeFromPath, placeOptions, PRIORITIES, type Place } from '@/lib/places';
import { cn } from '@/lib/utils';
import { inputClass } from './fields';

const WHEN = [
  { key: 'none', label: 'בלי תאריך' }, { key: 'today', label: 'היום' }, { key: 'tomorrow', label: 'מחר' }, { key: 'date', label: 'תאריך…' },
] as const;

const ilDate = (offset: number) => {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
};

// Quick Task: one field. Enter opens the small form (place, category, priority, when) with
// everything pre-filled from where you are; Enter again saves. "Context first": inside an
// entity or branch the place is that one, elsewhere it is Personal.
export function QuickTask({ place, path, autoFocus, onSaved, className }: {
  place?: Place; path?: string; autoFocus?: boolean; onSaved?: () => void; className?: string;
}) {
  const pathname = usePathname();
  const context = place ?? placeFromPath(pathname);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addTask, null);
  const [open, setOpen] = useState(false);
  const [where, setWhere] = useState(encodePlace(context));
  const [when, setWhen] = useState<(typeof WHEN)[number]['key']>('none');
  const form = useRef<HTMLFormElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const id = useId();
  const options = useMemo(placeOptions, []);
  const domain = decodePlace(where)?.domain ?? 'personal';
  const cats = categoriesFor(domain);

  useEffect(() => { setWhere(encodePlace(context)); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!state?.ok) return;
    form.current?.reset(); setOpen(false); setWhen('none');
    title.current?.focus(); onSaved?.();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const dueDate = when === 'today' ? ilDate(0) : when === 'tomorrow' ? ilDate(1) : undefined;

  return (
    <form ref={form} action={action} className={cn('flex flex-col gap-3', className)}
      onSubmit={e => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (!open && submitter?.value !== 'inbox') { e.preventDefault(); setOpen(true); }
      }}>
      <input type="hidden" name="path" value={path ?? pathname} />
      <input type="hidden" name="place" value={where} />
      <div className="flex gap-2">
        <label htmlFor={`${id}-t`} className="sr-only">מה צריך לעשות?</label>
        <input ref={title} id={`${id}-t`} name="title" required maxLength={300} autoFocus={autoFocus} autoComplete="off"
          placeholder="מה צריך לעשות?" className={cn(inputClass, 'h-10 text-base')} />
        <Button type="submit" name="mode" value="task" variant="primary" disabled={pending} className="h-10 shrink-0">
          <Plus className="size-4" aria-hidden />{open ? 'שמור' : 'הוסף'}
        </Button>
      </div>
      {open && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs text-muted">שייך ל
            <select value={where} onChange={e => setWhere(e.target.value)} className={inputClass}>
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">קטגוריה
            <select key={domain} name="category" defaultValue={domain === 'personal' && cats.some(c => c.id === 'personal') ? 'personal' : 'general'} className={inputClass}>
              {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">עדיפות
            <select name="priority" defaultValue="3" className={inputClass}>
              {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <fieldset className="flex flex-col gap-1 text-xs text-muted">
            <legend className="mb-1">מתי</legend>
            <select value={when} onChange={e => setWhen(e.target.value as typeof when)} aria-label="מתי" className={inputClass}>
              {WHEN.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
            </select>
          </fieldset>
          {when === 'date' ? (
            <label className="flex flex-col gap-1 text-xs text-muted">תאריך
              <input type="date" name="due_date" required className={inputClass} />
            </label>
          ) : dueDate ? <input type="hidden" name="due_date" value={dueDate} /> : null}
          {when !== 'none' && (
            <label className="flex flex-col gap-1 text-xs text-muted">שעה (לא חובה)
              <input type="time" name="due_time" className={inputClass} />
            </label>
          )}
          <div className="col-span-2 flex items-end gap-2 sm:col-span-4">
            <button type="submit" name="mode" value="inbox" disabled={pending}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
              <Inbox className="size-3.5" aria-hidden />לא בטוח איפה? שלח ל-Inbox
            </button>
            <span className="flex-1" />
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">ביטול</button>
          </div>
        </div>
      )}
      {state && !state.ok && <p role="alert" className="text-xs text-critical-ink">{state.error}</p>}
    </form>
  );
}
