'use client';
import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { removeMoney } from '@/app/actions';
import { Money } from '@/components/ui/money';
import { shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MoneyEntry } from '@/server/entries';

export function MoneyRow({ entry, path, ownerName }: { entry: MoneyEntry; path: string; ownerName: string }) {
  const [pending, start] = useTransition();
  return (
    <tr className={cn('border-b border-line last:border-0', pending && 'opacity-60')}>
      <td className="py-2 text-xs text-muted whitespace-nowrap">{shortDate(entry.occurred_on)}</td>
      <th scope="row" className="py-2 text-start font-normal">
        <bdi>{entry.category}</bdi>
        {entry.note && <span className="block text-xs text-muted"><bdi>{entry.note}</bdi></span>}
      </th>
      <td className="py-2 text-xs text-muted">{ownerName}</td>
      <td className={cn('py-2 text-end font-medium', entry.kind === 'income' ? 'text-good-ink' : 'text-ink')}>
        {entry.kind === 'income' ? '+' : '−'}<Money value={entry.amount} />
      </td>
      <td className="w-8 py-2 text-end">
        <button type="button" disabled={pending} aria-label="מחק רשומה"
          onClick={() => { if (confirm('למחוק את הרשומה?')) start(async () => { await removeMoney(entry.id, path); }); }}
          className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-critical-ink"><Trash2 className="size-4" aria-hidden /></button>
      </td>
    </tr>
  );
}
