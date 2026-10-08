import Link from 'next/link';
import type { DayBucket } from '@/server/day';
import { cn } from '@/lib/utils';

const dow = new Intl.DateTimeFormat('he-IL', { weekday: 'short', timeZone: 'UTC' });
const dm = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
const utc = (d: string) => new Date(`${d}T00:00:00Z`);

// Seven compact days: events and tasks per day, each linking to that day
export function WeekStrip({ days, today, connected }: { days: DayBucket[]; today: string; connected: boolean }) {
  return (
    <ul className="grid grid-cols-7 gap-1.5 sm:gap-2">
      {days.map(d => {
        const isToday = d.date === today;
        const open = d.tasks.filter(t => t.status !== 'done').length;
        return (
          <li key={d.date}>
            <Link href={isToday ? '/today' : `/today?d=${d.date}`} aria-label={`${dow.format(utc(d.date))} ${dm.format(utc(d.date))}: ${connected ? `${d.events.length} אירועים, ` : ''}${open} משימות`}
              className={cn('flex h-full flex-col items-center gap-1 rounded-lg border px-1 py-2.5 text-center transition-colors hover:bg-surface-2',
                isToday ? 'border-accent bg-accent-soft' : 'border-line')}>
              <span className={cn('text-xs', isToday ? 'font-semibold text-accent-ink' : 'text-muted')}>{dow.format(utc(d.date))}</span>
              <span className="text-sm font-medium tabular">{dm.format(utc(d.date))}</span>
              <span className="mt-1 flex flex-col gap-0.5 text-xs leading-tight text-ink-2 tabular">
                <span title="אירועים">{connected ? `${d.events.length} אירועים` : '–'}</span>
                <span title="משימות">{open} משימות</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
