import Link from 'next/link';
import { Clock, User } from 'lucide-react';
import type { ActivityItem } from '@/server/activity';
import { Badge } from '@/components/ui/badge';
import { stamp } from '@/lib/format';

// One entry per action, readable at a glance: the object (title, links to it), what was done,
// then where (context), who and when (Israel time) as metadata.
export function ActivityList({ items, showContext = true }: { items: ActivityItem[]; showContext?: boolean }) {
  return (
    <ol className="flex flex-col divide-y divide-[color:var(--border)]">
      {items.map(a => (
        <li key={a.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            {a.title && (a.href
              ? <Link href={a.href} className="w-fit text-body font-medium text-ink hover:text-accent-ink hover:underline"><bdi>{a.title}</bdi></Link>
              : <p className="text-body font-medium text-ink"><bdi>{a.title}</bdi></p>)}
            <p className={a.title ? 'text-sm text-ink-2' : 'text-body font-medium text-ink'}><bdi>{a.text}</bdi></p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
              {showContext && a.context && <Badge tone="accent"><bdi dir="rtl">{a.context}</bdi></Badge>}
              {a.actor && <span className="inline-flex items-center gap-1"><User className="size-4" aria-hidden /><span className="sr-only">מי: </span><bdi>{a.actor}</bdi></span>}
              <span className="inline-flex items-center gap-1 sm:hidden"><Clock className="size-4" aria-hidden /><time dateTime={a.at} className="tabular">{stamp(a.at)}</time></span>
            </p>
          </div>
          <time dateTime={a.at} className="hidden shrink-0 pt-0.5 text-xs text-muted tabular sm:block">{stamp(a.at)}</time>
        </li>
      ))}
    </ol>
  );
}
