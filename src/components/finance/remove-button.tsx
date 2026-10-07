'use client';
import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { removeReceivable, removeTransaction } from '@/app/finance-actions';

// Soft delete with a confirm. kind picks the action; errors are shown in an alert.
export function RemoveButton({ kind, id, path, label }: { kind: 'transaction' | 'receivable'; id: string; path: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} aria-label={label} title={label}
      onClick={() => {
        if (!confirm(`${label}?`)) return;
        start(async () => {
          const r = await (kind === 'transaction' ? removeTransaction : removeReceivable)(id, path);
          if (!r.ok) alert(r.error);
        });
      }}
      className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-critical-ink disabled:opacity-50">
      <Trash2 className="size-4" aria-hidden />
    </button>
  );
}
