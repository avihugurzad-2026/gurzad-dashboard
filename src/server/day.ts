import 'server-only';
import { addDays, ilDayStart, todayIL } from '@/lib/period';
import { calendarStatus, ensureFreshEvents, eventsBetween, type CalEvent } from './calendar';
import { tasksBetween, type WorkItem } from './entries';

export type DayBucket = { date: string; events: CalEvent[]; tasks: WorkItem[] };

// Events and dated tasks for `days` Israel days from `start`. Pulls fresh Google events first
// (bounded wait), so Home/Today/Calendar show the calendar without a manual refresh.
export async function agenda(start: string, days: number) {
  await ensureFreshEvents();
  const end = addDays(start, days);
  const [status, ev, tasks] = await Promise.all([
    calendarStatus(),
    eventsBetween(ilDayStart(start).toISOString(), ilDayStart(end).toISOString()),
    tasksBetween(start, addDays(end, -1)),
  ]);
  const buckets: DayBucket[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const from = ilDayStart(date).getTime(), to = ilDayStart(addDays(date, 1)).getTime();
    buckets.push({
      date,
      events: ev.events.filter(e => new Date(e.start_at).getTime() < to
        && (new Date(e.end_at).getTime() > from || (e.end_at === e.start_at && new Date(e.start_at).getTime() >= from))),
      tasks: tasks.filter(t => t.due_date === date),
    });
  }
  return { today: todayIL(), configured: status.configured, connected: ev.connected, connection: status.connection, days: buckets };
}
