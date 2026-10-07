'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Circle, CircleCheck, Trash2, Undo2, Unlink } from 'lucide-react';
import {
  removeCase, removeDeadline, removeInvestment, removeLoan, removeProperty, toggleDeadline, undoRepayment, unlinkContact,
  type VenturesResult,
} from '@/app/ventures-actions';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ACTIONS = {
  property: removeProperty, loan: removeLoan, investment: removeInvestment, case: removeCase,
  deadline: removeDeadline, repayment: undoRepayment, contact: unlinkContact,
} satisfies Record<string, (id: string, path: string) => Promise<VenturesResult>>;

// Soft delete / undo with a confirm. `after` navigates away (e.g. back to the list after deleting an object).
export function VentureRemove({ kind, id, path, label, after, text }: {
  kind: keyof typeof ACTIONS; id: string; path: string; label: string; after?: string; text?: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const Icon = kind === 'repayment' ? Undo2 : kind === 'contact' ? Unlink : Trash2;
  return (
    <button type="button" disabled={pending} aria-label={label} title={label}
      onClick={() => {
        if (!confirm(`${label}?`)) return;
        start(async () => {
          const r = await ACTIONS[kind](id, path);
          if (!r.ok) alert(r.error);
          else if (after) router.push(after);
        });
      }}
      className={text ? buttonClass('ghost', 'sm', 'text-critical-ink') : 'rounded-md p-1 text-muted hover:bg-surface-2 hover:text-critical-ink disabled:opacity-50'}>
      <Icon className="size-4" aria-hidden />{text}
    </button>
  );
}

export function DeadlineToggle({ id, done, path }: { id: string; done: boolean; path: string }) {
  const [pending, start] = useTransition();
  const Icon = done ? CircleCheck : Circle;
  return (
    <button type="button" disabled={pending} aria-label={done ? 'החזר לפתוח' : 'סמן שבוצע'}
      onClick={() => start(async () => { const r = await toggleDeadline(id, path); if (!r.ok) alert(r.error); })}
      className={cn('mt-0.5 shrink-0 hover:text-ink', done ? 'text-good' : 'text-muted', pending && 'opacity-50')}>
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
