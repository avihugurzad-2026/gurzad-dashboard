'use client';
import { useActionState, useEffect, useRef } from 'react';
import { Paperclip, Plus } from 'lucide-react';
import { addInbox, type ActionResult } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/work/fields';

// Drop anything here: a thought, a note, a file. Sorting it comes later.
export function InboxCapture() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addInbox, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) form.current?.reset(); }, [state]);
  return (
    <form ref={form} action={action} className="flex flex-col gap-2">
      <label htmlFor="inbox-text" className="sr-only">מה להכניס ל-Inbox</label>
      <textarea id="inbox-text" name="text" rows={2} maxLength={4000} placeholder="רעיון, הערה, משימה שעוד לא ברור איפה היא…"
        className={`${inputClass} h-auto py-2`} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2">
          <Paperclip className="size-4" aria-hidden />צרף קובץ
          <input type="file" name="file" className="sr-only" />
        </label>
        <span className="text-xs text-muted">עד 4MB</span>
        <span className="flex-1" />
        <Button type="submit" variant="primary" disabled={pending}><Plus className="size-4" aria-hidden />הכנס ל-Inbox</Button>
      </div>
      {state && !state.ok && <p role="alert" className="text-xs text-critical-ink">{state.error}</p>}
    </form>
  );
}
