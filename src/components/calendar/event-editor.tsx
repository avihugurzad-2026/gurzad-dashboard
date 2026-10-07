'use client';
import { createContext, useActionState, useContext, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarPlus, Trash2, TriangleAlert, X } from 'lucide-react';
import { deleteEventAction, resolveConflictAction, saveEventAction, type CalendarActionResult } from '@/app/calendar-actions';
import { Button, buttonClass } from '@/components/ui/button';
import { inputClass } from '@/components/work/fields';
import { encodePlace, placeOptions, type Domain } from '@/lib/places';
import { ilDate, ilTime, todayIL } from '@/lib/period';
import { cn } from '@/lib/utils';
import type { CalEvent, EventEditor, EventVersion } from '@/server/calendar';

// "+ אירוע" and event editing (stage 2.2). A page wraps its content in <EventEditorProvider>
// (with eventEditor() from the server); <NewEventButton> opens the dialog empty, <EventChip>
// opens it for an event the user may write. Without a provider, chips fall back to the Google link.

type Ctx = { editor: EventEditor; openNew: (date?: string) => void; openEdit: (e: CalEvent) => void; sync: (e: CalEvent) => void };
const EditorContext = createContext<Ctx | null>(null);
export const useEventEditor = () => useContext(EditorContext);

export function EventEditorProvider({ editor, children }: { editor: EventEditor; children: React.ReactNode }) {
  const [state, setState] = useState<{ open: boolean; date?: string; event: CalEvent | null; n: number }>({ open: false, event: null, n: 0 });
  const ctx = useMemo<Ctx>(() => ({
    editor,
    openNew: date => setState(s => ({ open: true, date, event: null, n: s.n + 1 })),
    openEdit: event => setState(s => ({ open: true, event, n: s.n + 1 })),
    // After a save/refresh the page re-renders with fresh rows; keep the open dialog on the fresh copy
    sync: event => setState(s => (s.open && s.event?.id === event.id && s.event !== event ? { ...s, event } : s)),
  }), [editor]);
  return (
    <EditorContext.Provider value={ctx}>
      {children}
      <EventDialog key={state.n} open={state.open} onClose={() => setState(s => ({ ...s, open: false }))}
        event={state.event} editor={editor} defaultDate={state.date} />
    </EditorContext.Provider>
  );
}

// The "+ אירוע" button. Read-only connections show why writing is off.
export function NewEventButton({ date, className }: { date?: string; className?: string }) {
  const ctx = useEventEditor();
  if (!ctx || ctx.editor.mode === 'none') return null;
  if (ctx.editor.mode === 'readonly') {
    return (
      <Link href="/settings#calendar" title={ctx.editor.reason ?? undefined} className={buttonClass('secondary', 'sm', className)}>
        <CalendarPlus className="size-4" aria-hidden />חבר מחדש כדי לאפשר כתיבה
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => ctx.openNew(date)} aria-haspopup="dialog" className={buttonClass('primary', 'sm', className)}>
      <CalendarPlus className="size-4" aria-hidden />אירוע
    </button>
  );
}

// An event in a list: opens the dialog when the user may write it (or it has a conflict),
// otherwise links to Google
export function EventChip({ event, className, style, children }: { event: CalEvent; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const ctx = useEventEditor();
  useEffect(() => { ctx?.sync(event); }, [event]); // eslint-disable-line react-hooks/exhaustive-deps
  const mark = event.conflict
    ? <TriangleAlert className="me-1 inline size-3.5 align-[-2px] text-critical-ink" aria-label="יש התנגשות עם Google" />
    : null;
  if (ctx && (event.writable || event.conflict)) {
    return (
      <button type="button" onClick={() => ctx.openEdit(event)} aria-haspopup="dialog" style={style}
        className={cn('w-full cursor-pointer text-start', className)}>
        {mark}{children}
      </button>
    );
  }
  if (event.html_link) return <a href={event.html_link} target="_blank" rel="noreferrer" style={style} className={cn('block', className)}>{mark}{children}</a>;
  return <div style={style} className={className}>{mark}{children}</div>;
}

const dateFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Jerusalem' });
function when(v: EventVersion): string {
  if (v.all_day) {
    const last = ilDate(new Date(new Date(v.end_at).getTime() - 1));
    const first = ilDate(v.start_at);
    return last > first ? `${dateFmt.format(new Date(v.start_at))} – ${dateFmt.format(new Date(new Date(v.end_at).getTime() - 1))} · כל היום` : `${dateFmt.format(new Date(v.start_at))} · כל היום`;
  }
  return `${dateFmt.format(new Date(v.start_at))} · ${ilTime(v.start_at)}–${ilTime(v.end_at)}`;
}

// Both versions side by side, and the user's choice
export function ConflictPanel({ event, onDone }: { event: CalEvent; onDone?: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const path = usePathname();
  const c = event.conflict;
  if (!c) return null;
  const choose = (choice: 'mine' | 'google') => start(async () => {
    const r = await resolveConflictAction(event.id, choice, path);
    if (r.ok) onDone?.(); else setError(r.error);
  });
  const Version = ({ title, v }: { title: string; v: EventVersion | null }) => (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-line p-3">
      <p className="text-xs font-medium text-muted">{title}</p>
      {v ? (
        <>
          <p className="text-sm font-medium"><bdi>{v.title || '(ללא כותרת)'}</bdi></p>
          <p className="text-xs text-ink-2 tabular"><bdi>{when(v)}</bdi></p>
          {v.description && <p className="line-clamp-4 whitespace-pre-line text-xs text-muted"><bdi>{v.description}</bdi></p>}
        </>
      ) : <p className="text-sm text-muted">האירוע נמחק ב-Google.</p>}
    </div>
  );
  return (
    <section aria-label="התנגשות עם Google" className="flex flex-col gap-3 rounded-lg bg-critical-soft/60 p-3">
      <p className="flex items-start gap-2 text-sm text-critical-ink">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        האירוע השתנה ב-Google אחרי הסנכרון האחרון, ולכן השינוי שלך לא נשמר. בחר איזו גרסה להשאיר.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Version title="השינוי שלי" v={c.mine} />
        <Version title="הגרסה ב-Google" v={c.google} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={pending} onClick={() => choose('mine')}>שמור את שלי</Button>
        <Button size="sm" disabled={pending} onClick={() => choose('google')}>קבל את Google</Button>
      </div>
      {error && <p role="alert" className="text-xs text-critical-ink">{error}</p>}
    </section>
  );
}

// The event dialog: new (event = null) or edit. Calendar choice only when creating.
export function EventDialog({ open, onClose, event, editor, defaultDate }: {
  open: boolean; onClose: () => void; event: CalEvent | null; editor: EventEditor; defaultDate?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const path = usePathname();
  const id = useId();
  const [state, action, pending] = useActionState<CalendarActionResult | null, FormData>(saveEventAction, null);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const options = useMemo(placeOptions, []);

  const initial = useMemo(() => {
    if (!event) return { date: defaultDate ?? todayIL(), endDate: '', allDay: false, start: '09:00', end: '10:00', place: '' };
    const lastDay = event.all_day ? ilDate(new Date(new Date(event.end_at).getTime() - 1)) : ilDate(event.end_at);
    const date = ilDate(event.start_at);
    return {
      date, endDate: lastDay > date ? lastDay : '', allDay: event.all_day,
      start: event.all_day ? '09:00' : ilTime(event.start_at), end: event.all_day ? '10:00' : ilTime(event.end_at),
      place: event.domain ? encodePlace({ domain: event.domain as Domain, branch: event.branch, location: event.location }) : '',
    };
  }, [event, defaultDate]);
  const [allDay, setAllDay] = useState(initial.allDay);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => { if (state?.ok) onClose(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const editing = event !== null;
  const readOnly = editing && !event.writable;
  const title = editing ? (readOnly ? 'אירוע' : 'עריכת אירוע') : 'אירוע חדש';
  const calendars = editor.calendars;

  return (
    <dialog ref={dialog} onClose={onClose} aria-label={title} dir="rtl"
      className="m-auto w-[min(640px,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40">
      {open && (
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className={buttonClass('ghost', 'icon')} aria-label="סגירה"><X className="size-4" /></button>
          </div>

          {event?.conflict && <ConflictPanel event={event} onDone={onClose} />}

          {!editing && editor.mode === 'manual' && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
              יומן Google לא מחובר, אז האירוע יישמר רק בדשבורד. <Link href="/settings#calendar" className="text-accent hover:underline">לחבר את היומן</Link>
            </p>
          )}
          {readOnly && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
              אין לך הרשאת כתיבה לאירוע הזה מכאן.{event?.html_link && <> <a href={event.html_link} target="_blank" rel="noreferrer" className="text-accent hover:underline">פתח ב-Google</a></>}
            </p>
          )}

          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="path" value={path} />
            {editing && <input type="hidden" name="id" value={event.id} />}
            <fieldset disabled={readOnly || pending} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="col-span-2 flex flex-col gap-1 text-xs text-muted sm:col-span-4">כותרת
                <input name="title" required maxLength={500} defaultValue={event?.title ?? ''} autoFocus={!editing} autoComplete="off"
                  className={cn(inputClass, 'h-10 text-base')} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">תאריך
                <input type="date" name="date" required defaultValue={initial.date} className={inputClass} />
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
                <input type="checkbox" name="all_day" checked={allDay} onChange={e => setAllDay(e.target.checked)} className="size-4" />כל היום
              </label>
              {allDay ? (
                <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">עד תאריך (לא חובה)
                  <input type="date" name="end_date" defaultValue={initial.endDate} className={inputClass} />
                </label>
              ) : (
                <>
                  <label className="flex flex-col gap-1 text-xs text-muted">משעה
                    <input type="time" name="start_time" required defaultValue={initial.start} className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted">עד שעה
                    <input type="time" name="end_time" defaultValue={initial.end} className={inputClass} />
                  </label>
                </>
              )}
              <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">שייך ל
                <select name="place" defaultValue={initial.place} className={inputClass}>
                  <option value="">ללא שיוך</option>
                  {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              {!editing && editor.mode === 'google' && (
                <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">יומן
                  <select name="mapping_id" defaultValue="" className={inputClass}>
                    <option value="">אוטומטי (לפי השיוך, אחרת ברירת המחדל)</option>
                    {calendars.map(c => <option key={c.id} value={c.id}>{c.name ?? 'יומן'}{c.is_default_write ? ' · ברירת מחדל' : ''}</option>)}
                  </select>
                </label>
              )}
              {editing && event.calendar_name && (
                <p className="col-span-2 self-end pb-2 text-xs text-muted">יומן: <bdi>{event.calendar_name}</bdi></p>
              )}
              <label htmlFor={`${id}-d`} className="col-span-2 flex flex-col gap-1 text-xs text-muted sm:col-span-4">תיאור (לא חובה)
                <textarea id={`${id}-d`} name="description" rows={3} maxLength={4000} defaultValue={event?.description ?? ''}
                  className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink" />
              </label>
            </fieldset>

            {!readOnly && (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" variant="primary" disabled={pending || deleting}>{pending ? 'שומר…' : 'שמור'}</Button>
                <Button type="button" variant="ghost" onClick={onClose}>ביטול</Button>
                <span className="flex-1" />
                {editing && (
                  <Button type="button" variant="ghost" disabled={pending || deleting} className="text-critical-ink"
                    onClick={() => {
                      if (!confirm(event.source === 'google' ? 'למחוק את האירוע? הוא יימחק גם מיומן Google.' : 'למחוק את האירוע?')) return;
                      startDelete(async () => {
                        const r = await deleteEventAction(event.id, path);
                        if (r.ok) onClose(); else setDeleteError(r.error);
                      });
                    }}>
                    <Trash2 className="size-4" aria-hidden />מחק
                  </Button>
                )}
              </div>
            )}
            {state && !state.ok && !state.conflict && <p role="alert" className="text-xs text-critical-ink">{state.error}</p>}
            {state && !state.ok && state.conflict && !event?.conflict && <p role="status" className="text-xs text-critical-ink">{state.error}</p>}
            {deleteError && <p role="alert" className="text-xs text-critical-ink">{deleteError}</p>}
          </form>
        </div>
      )}
    </dialog>
  );
}
