import { ilDate, ilTime } from '@/lib/period';
import { contextLabel } from '@/lib/places';
import type { DayBucket } from '@/server/day';
import type { TimelineItem } from './timeline';

// A day's events and tasks as timeline rows (times in Israel; an event that started before
// this day or runs past it shows only the part inside the day)
export function toItems(day: DayBucket): TimelineItem[] {
  const events: TimelineItem[] = day.events.map(e => {
    const startsHere = ilDate(e.start_at) === day.date, endsHere = ilDate(e.end_at) === day.date;
    const allDay = e.all_day || (!startsHere && !endsHere);
    return {
      key: `e-${e.id}`, kind: 'event', title: e.title,
      start: allDay ? null : startsHere ? ilTime(e.start_at) : '00:00',
      end: allDay ? null : endsHere ? ilTime(e.end_at) : null,
      context: e.domain ? contextLabel({ domain: e.domain, branch: e.branch, location: e.location }) : e.calendar_name,
      place: e.place, color: e.color, href: e.html_link,
    };
  });
  const tasks: TimelineItem[] = day.tasks.map(t => ({
    key: `t-${t.source}-${t.id}`, kind: 'task', title: t.title, start: t.due_time, end: null, context: t.context,
    done: t.status === 'done',
  }));
  return [...events, ...tasks];
}
