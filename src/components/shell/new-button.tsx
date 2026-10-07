'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Inbox, Plus, X } from 'lucide-react';
import { QuickTask } from '@/components/work/quick-task';
import { buttonClass } from '@/components/ui/button';

// Global "+ חדש": a task in two Enters from any screen, pre-filled with the screen's place.
// Shortcut: "n" when not typing.
export function NewButton() {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass('primary', 'sm')} aria-haspopup="dialog" aria-keyshortcuts="n">
        <Plus className="size-4" aria-hidden />חדש
      </button>
      <dialog ref={dialog} onClose={() => setOpen(false)} aria-label="משימה חדשה"
        className="m-auto w-[min(640px,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40">
        {open && (
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">משימה חדשה</h2>
              <button type="button" onClick={() => setOpen(false)} className={buttonClass('ghost', 'icon')} aria-label="סגירה"><X className="size-4" /></button>
            </div>
            <QuickTask autoFocus onSaved={() => setOpen(false)} />
            <Link href="/inbox" onClick={() => setOpen(false)} className="inline-flex items-center gap-1.5 self-start text-xs text-muted hover:text-ink">
              <Inbox className="size-3.5" aria-hidden />קובץ, רעיון או הערה? ל-Inbox
            </Link>
          </div>
        )}
      </dialog>
    </>
  );
}
