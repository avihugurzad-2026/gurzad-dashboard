'use client';
import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { removeReceivable, removeTransaction } from '@/app/finance-actions';
import { buttonClass } from '@/components/ui/button';

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
      className={buttonClass('ghost', 'icon', 'size-8 text-muted hover:text-critical-ink')}>
      <Trash2 aria-hidden />
    </button>
  );
}
