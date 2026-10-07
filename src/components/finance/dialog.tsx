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
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={triggerClass ?? buttonClass('primary', 'sm')}>{trigger}</button>
      <dialog ref={ref} onClose={() => setOpen(false)} aria-label={title}
        className={`m-auto ${wide ? 'w-[min(760px,calc(100vw-2rem))]' : 'w-[min(440px,calc(100vw-2rem))]'} max-h-[calc(100dvh-2rem)] rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40`}>
        {open && (
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">{title}</h2>
              <button type="button" onClick={() => setOpen(false)} className={buttonClass('ghost', 'icon')} aria-label="סגירה"><X className="size-4" /></button>
            </div>
            {children(() => setOpen(false))}
          </div>
        )}
      </dialog>
    </>
  );
}
