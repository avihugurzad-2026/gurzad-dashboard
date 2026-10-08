'use client';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { buttonClass } from '@/components/ui/button';

// A modal <dialog> with its own trigger button. The body gets `close` so a form can shut it on save.
export function FormDialog({ trigger, title, triggerClass, children, wide = true }: {
  trigger: React.ReactNode; title: string; triggerClass?: string; wide?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // With a mouse, start in the first field rather than on the close button. Not on touch screens,
      // where that would pop the keyboard over the form.
      if (window.matchMedia('(pointer: fine)').matches)
        d.querySelector<HTMLElement>('input:not([type=hidden]):not([aria-hidden]), select, textarea')?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  // A save error appears under the button; on a phone that is below the fold of a long form,
  // so bring it into view when it shows up
  useEffect(() => {
    const d = ref.current;
    if (!d || !open) return;
    const seen = new WeakSet<Element>();
    const obs = new MutationObserver(() => {
      const alert = d.querySelector('[role=alert]');
      if (alert && !seen.has(alert)) { seen.add(alert); alert.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    });
    obs.observe(d, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={triggerClass ?? buttonClass('primary', 'md')}>{trigger}</button>
      <dialog ref={ref} onClose={() => setOpen(false)} aria-label={title}
        className={`m-auto ${wide ? 'w-[min(760px,calc(100vw-2rem))]' : 'w-[min(440px,calc(100vw-2rem))]'} max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40`}>
        {open && (
          <div className="flex flex-col gap-5 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-card font-semibold text-ink"><bdi>{title}</bdi></h2>
              <button type="button" onClick={() => setOpen(false)} className={buttonClass('ghost', 'icon')} aria-label="סגירה"><X aria-hidden /></button>
            </div>
            {children(() => setOpen(false))}
          </div>
        )}
      </dialog>
    </>
  );
}
