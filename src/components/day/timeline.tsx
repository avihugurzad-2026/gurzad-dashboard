'use client';
import { useEffect, useState } from 'react';
import { CalendarDays, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EventChip } from '@/components/calendar/event-editor';
import type { CalEvent } from '@/server/calendar';

export type TimelineItem = {
  key: string; kind: 'event' | 'task'; title: string; start: string | null; end: string | null; // Israel "HH:MM"; null = all day / no time
  context?: string | null; place?: string | null; color?: string | null; href?: string | null; done?: boolean;
  event?: CalEvent; // events: opens the event dialog when inside an EventEditorProvider and writable
};

const nowHM = () => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jerusalem' }).format(new Date());

// One day in time order: untimed items first, then a time line with a "now" marker between the
// item that has started and the next one (only when the day shown is today)
export function Timeline({ items, isToday }: { items: TimelineItem[]; isToday: boolean }) {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    if (!isToday) return;
    setNow(nowHM());
    const t = setInterval(() => setNow(nowHM()), 30000);
    return () => clearInterval(t);
  }, [isToday]);
  const untimed = items.filter(i => !i.start);
  const timed = items.filter(i => i.start).sort((a, b) => a.start!.localeCompare(b.start!));
  const nowIndex = now ? timed.findIndex(i => i.start! > now) : -1;
  const marker = now !== null ? (nowIndex === -1 ? timed.length : nowIndex) : -1;

  return (
    <div className="flex flex-col gap-3">
      {untimed.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="כל היום">
          {untimed.map(i => <Row key={i.key} item={i} />)}
        </ul>
      )}
      <ol className="relative flex flex-col border-s border-line ps-4" aria-label="לפי שעה">
        {timed.map((i, n) => (
          <li key={i.key} className="relative py-1.5">
            {n === marker && <NowLine time={now!} />}
            <span className="absolute -start-[21px] top-3.5 size-2 rounded-full border-2 border-surface"
              style={{ background: i.color ?? 'var(--series-1)' }} aria-hidden />
            <Row item={i} />
          </li>
        ))}
        {marker === timed.length && now && <li className="relative py-1.5"><NowLine time={now} /></li>}
      </ol>
    </div>
  );
}

function NowLine({ time }: { time: string }) {
  return (
    <div className="relative -ms-4 mb-1 flex items-center gap-2" role="note" aria-label={`עכשיו ${time}`}>
      <span className="-ms-[5px] size-2.5 rounded-full bg-critical" aria-hidden />
      <span className="h-px flex-1 bg-critical" aria-hidden />
      <span className="text-[11px] font-medium text-critical-ink tabular">עכשיו {time}</span>
    </div>
  );
}

function Row({ item }: { item: TimelineItem }) {
  const Icon = item.kind === 'event' ? CalendarDays : ListChecks;
  const body = (
    <div className="flex items-start gap-3">
      <span className="w-20 shrink-0 pt-0.5 text-xs text-muted tabular">
        {item.start ? <>{item.start}{item.end && item.end !== item.start ? `–${item.end}` : ''}</> : item.kind === 'event' ? 'כל היום' : 'היום'}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('flex items-center gap-1.5 text-sm text-ink', item.done && 'text-muted line-through')}>
          <Icon className="size-3.5 shrink-0 text-muted" aria-label={item.kind === 'event' ? 'אירוע' : 'משימה'} />
          <bdi className="truncate">{item.title || '(ללא כותרת)'}</bdi>
        </p>
        {(item.context || item.place) && (
          <p className="truncate text-xs text-muted"><bdi dir="rtl">{[item.context, item.place].filter(Boolean).join(' · ')}</bdi></p>
        )}
      </div>
    </div>
  );
  if (item.event) return <EventChip event={item.event} className="block rounded-md hover:bg-surface-2/60">{body}</EventChip>;
  return item.href
    ? <a href={item.href} target="_blank" rel="noreferrer" className="block rounded-md hover:bg-surface-2/60">{body}</a>
    : body;
}
