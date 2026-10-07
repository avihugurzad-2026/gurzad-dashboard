import Link from 'next/link';
import type { ActivityItem } from '@/server/activity';
import { stamp } from '@/lib/format';

// One line per action: "אביהו יצר משימה «לחדש ביטוח»" · place · time (Israel)
export function ActivityList({ items, showContext = true }: { items: ActivityItem[]; showContext?: boolean }) {
  return (
    <ol className="flex flex-col divide-y divide-[color:var(--border)]">
      {items.map(a => (
        <li key={a.id} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <p className="min-w-0 text-sm text-ink">
            {a.actor && <span className="font-medium">{a.actor} </span>}
            <span>{a.text}</span>
            {a.title && (
              <> {a.href
                ? <Link href={a.href} className="text-accent hover:underline">«<bdi>{a.title}</bdi>»</Link>
                : <span className="text-ink-2">«<bdi>{a.title}</bdi>»</span>}</>
            )}
          </p>
          <p className="flex shrink-0 flex-wrap gap-x-2 text-xs text-muted">
            {showContext && a.context && <bdi dir="rtl">{a.context}</bdi>}
            <time dateTime={a.at}>{stamp(a.at)}</time>
          </p>
        </li>
      ))}
    </ol>
  );
}
