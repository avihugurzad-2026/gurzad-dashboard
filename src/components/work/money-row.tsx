'use client';
import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { removeMoney } from '@/app/actions';
import { buttonClass } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import { shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MoneyEntry } from '@/server/entries';

export function MoneyRow({ entry, path, ownerName }: { entry: MoneyEntry; path: string; ownerName: string }) {
  const [pending, start] = useTransition();
  return (
    <tr className={cn(pending && 'opacity-60')}>
      <td className="whitespace-nowrap text-muted tabular">{shortDate(entry.occurred_on)}</td>
      <th scope="row" className="font-normal text-ink">
        <bdi>{entry.category}</bdi>
        {entry.note && <span className="block text-xs text-muted"><bdi>{entry.note}</bdi></span>}
      </th>
      <td className="text-muted"><bdi>{ownerName}</bdi></td>
      <td className={cn('num font-medium', entry.kind === 'income' ? 'text-good-ink' : 'text-ink')}>
        {entry.kind === 'income' ? '+' : '−'}<Money value={entry.amount} />
      </td>
      <td className="w-10 text-end">
        <button type="button" disabled={pending} aria-label="מחק רשומה"
          onClick={() => { if (confirm('למחוק את הרשומה?')) start(async () => { await removeMoney(entry.id, path); }); }}
          className={buttonClass('ghost', 'icon', 'size-8 text-muted hover:text-critical-ink')}><Trash2 aria-hidden /></button>
      </td>
    </tr>
  );
}
