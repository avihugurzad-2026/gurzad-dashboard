'use client';
import { submitWith } from '@/lib/submit';
import { useActionState, useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Inbox, Plus } from 'lucide-react';
import { addTask, type ActionResult } from '@/app/actions';
import { Button, buttonClass } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { categoriesFor, decodePlace, encodePlace, placeFromPath, placeOptions, PRIORITIES, type Place } from '@/lib/places';
import { cn } from '@/lib/utils';
import { useSession } from '@/components/shell/session-context';
import { inputClass, labelClass, selectClass } from './fields';

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
export function QuickTask({ place, path, defaultDate, autoFocus, onSaved, className }: {
  place?: Place; path?: string; defaultDate?: string; autoFocus?: boolean; onSaved?: () => void; className?: string;
}) {
  const pathname = usePathname();
  const session = useSession();
  const options = useMemo(() => {
    const all = placeOptions();
    return session ? all.filter(o => session.places.includes(o.value)) : all;
  }, [session]);
  // "Context first", but only a place this user may add to
  const wanted = place ?? placeFromPath(pathname);
  const context = options.some(o => o.value === encodePlace(wanted)) ? wanted : (options[0]?.place ?? wanted);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addTask, null);
  const [open, setOpen] = useState(false);
  const [where, setWhere] = useState(encodePlace(context));
  const [when, setWhen] = useState<(typeof WHEN)[number]['key']>(defaultDate ? 'date' : 'none');
  const [time, setTime] = useState('');
  const me = session?.user.id ?? null;
  const [assignee, setAssignee] = useState(me ?? '');
  const form = useRef<HTMLFormElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const id = useId();
  const domain = decodePlace(where)?.domain ?? 'personal';
  const cats = categoriesFor(domain);

  useEffect(() => { setWhere(encodePlace(context)); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!state?.ok) return;
    if (state.warning) alert(state.warning);
    form.current?.reset(); setOpen(false); setWhen('none'); setTime(''); setAssignee(me ?? '');
    title.current?.focus(); onSaved?.();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const dueDate = when === 'date' ? defaultDate : when === 'today' ? ilDate(0) : when === 'tomorrow' ? ilDate(1) : undefined;

  return (
    <form ref={form} className={cn('flex flex-col gap-3', className)}
      onSubmit={e => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (!open && submitter?.value !== 'inbox') { e.preventDefault(); setOpen(true); return; }
        submitWith(action)(e);
      }}>
      <input type="hidden" name="path" value={path ?? pathname} />
      <input type="hidden" name="place" value={where} />
      <div className="flex gap-2">
        <label htmlFor={`${id}-t`} className="sr-only">מה צריך לעשות?</label>
        <input ref={title} id={`${id}-t`} name="title" required maxLength={300} autoFocus={autoFocus} autoComplete="off"
          placeholder="מה צריך לעשות?" className={cn(inputClass, 'text-body')} />
        <Button type="submit" name="mode" value="task" variant="primary" size="lg" disabled={pending}>
          <Plus className="size-4" aria-hidden />{open ? 'שמור' : 'הוסף'}
        </Button>
      </div>
      {open && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
          <label className={cn(labelClass, 'flex flex-col gap-1.5')}>שייך ל
            <select value={where} onChange={e => setWhere(e.target.value)} className={selectClass}>
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className={cn(labelClass, 'flex flex-col gap-1.5')}>קטגוריה
            <select key={domain} name="category" defaultValue={domain === 'personal' && cats.some(c => c.id === 'personal') ? 'personal' : 'general'} className={selectClass}>
              {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className={cn(labelClass, 'flex flex-col gap-1.5')}>עדיפות
            <select name="priority" defaultValue="3" className={selectClass}>
              {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <fieldset className={cn(labelClass, 'flex flex-col gap-1.5')}>
            <legend className="mb-1.5">מתי</legend>
            <select value={when} onChange={e => setWhen(e.target.value as typeof when)} aria-label="מתי" className={selectClass}>
              {WHEN.map(w => <option key={w.key} value={w.key}>{w.label}</option>)}
            </select>
          </fieldset>
          {when === 'date' && !defaultDate ? (
            <label className={cn(labelClass, 'flex flex-col gap-1.5')}>תאריך
              <DateField name="due_date" required aria-label="תאריך" />
            </label>
          ) : dueDate ? <input type="hidden" name="due_date" value={dueDate} /> : null}
          {when !== 'none' && (
            <label className={cn(labelClass, 'flex flex-col gap-1.5')}>שעה (לא חובה)
              <input type="time" name="due_time" value={time} onChange={e => setTime(e.target.value)} className={cn(inputClass, 'tabular')} />
            </label>
          )}
          {session && session.people.length > 1 && (
            <label className={cn(labelClass, 'flex flex-col gap-1.5')}>מי עושה
              <select name="assigned_to" value={assignee} onChange={e => setAssignee(e.target.value)} className={selectClass}>
                {session.people.map(p => <option key={p.id} value={p.id}>{p.id === me ? `אני (${p.name})` : p.name}</option>)}
              </select>
            </label>
          )}
          <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-2 sm:col-span-4">
            {session && session.people.length > 1 && (
              <label className="inline-flex items-center gap-2">
                <input key={assignee === me ? 'free' : 'handed'} type="checkbox" name="scope" value="shared"
                  defaultChecked={assignee !== me} disabled={assignee !== me} className="size-4" />
                משותף (גם אחרים עם גישה למקום הזה יראו)
              </label>
            )}
            {when !== 'none' && time && (
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" name="show_in_calendar" className="size-4" />הצג ביומן Google
              </label>
            )}
          </div>
          <div className="col-span-2 flex items-center gap-2 sm:col-span-4">
            <button type="submit" name="mode" value="inbox" disabled={pending}
              className={buttonClass('ghost', 'sm', '-ms-3 text-accent-ink')}>
              <Inbox aria-hidden />לא בטוח איפה? שלח ל-Inbox
            </button>
            <span className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>ביטול</Button>
          </div>
        </div>
      )}
      {state && !state.ok && <p role="alert" className="text-sm text-critical-ink">{state.error}</p>}
    </form>
  );
}
