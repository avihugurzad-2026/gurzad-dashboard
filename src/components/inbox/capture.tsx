'use client';
import { submitWith } from '@/lib/submit';
import { useActionState, useEffect, useRef } from 'react';
import { Paperclip, Plus } from 'lucide-react';
import { addInbox, type ActionResult } from '@/app/actions';
import { Button, buttonClass } from '@/components/ui/button';
import { textareaClass } from '@/components/work/fields';

// Drop anything here: a thought, a note, a file. Sorting it comes later.
export function InboxCapture() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addInbox, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) form.current?.reset(); }, [state]);
  return (
    <form ref={form} onSubmit={submitWith(action)} className="flex flex-col gap-3">
      <label htmlFor="inbox-text" className="sr-only">מה להכניס ל-Inbox</label>
      <textarea id="inbox-text" name="text" rows={2} maxLength={4000} placeholder="רעיון, הערה, משימה שעוד לא ברור איפה היא…"
        className={textareaClass} />
      <div className="flex flex-wrap items-center gap-2">
        <label className={buttonClass('secondary', 'md', 'cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent')}>
          <Paperclip aria-hidden />צרף קובץ
          <input type="file" name="file" className="sr-only" />
        </label>
        <span className="text-xs text-muted">עד 4MB</span>
        <span className="flex-1" />
        <Button type="submit" variant="primary" disabled={pending}><Plus aria-hidden />הכנס ל-Inbox</Button>
      </div>
      {state && !state.ok && <p role="alert" className="text-sm text-critical-ink">{state.error}</p>}
    </form>
  );
}
