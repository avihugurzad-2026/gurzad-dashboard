import { Money } from '@/components/ui/money';

// One-series horizontal bars (magnitude). Values are printed as text, so the bar never carries meaning alone.
export function BarList({ items, empty = 'אין נתונים עדיין' }: { items: { key: string; label: string; value: number; hint?: string }[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>;
  const max = Math.max(...items.map(i => i.value), 0);
  const total = items.reduce((a, i) => a + i.value, 0);
  return (
    <ul className="flex flex-col gap-3">
      {items.map(i => (
        <li key={i.key} className="flex flex-col gap-1" title={i.hint}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <bdi className="min-w-0 truncate text-ink-2">{i.label}</bdi>
            <span className="flex shrink-0 items-center gap-2">
              {total > 0 && <span className="text-xs text-muted tabular">{Math.round((i.value / total) * 100)}%</span>}
              <Money value={i.value} className="font-medium" />
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-[color:var(--grid)]" aria-hidden>
            <div className="h-1.5 rounded-full bg-[color:var(--series-1)]" style={{ width: `${max > 0 ? Math.max(2, (i.value / max) * 100) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
