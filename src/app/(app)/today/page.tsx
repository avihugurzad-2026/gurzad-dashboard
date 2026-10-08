import Link from 'next/link';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { agenda } from '@/server/day';
import { taskGroups } from '@/server/entries';
import { addDays, todayIL } from '@/lib/period';
import { Timeline } from '@/components/day/timeline';
import { toItems } from '@/components/day/to-items';
import { CalendarCta } from '@/components/day/calendar-cta';
import { EventEditorProvider, NewEventButton } from '@/components/calendar/event-editor';
import { eventEditor } from '@/server/calendar';
import { QuickTask } from '@/components/work/quick-task';
import { TaskRow } from '@/components/work/task-row';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { buttonClass } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shell/page-header';

export const metadata = { title: 'היום — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const long = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The work board for one day: its events and tasks in time order, and (today) what is overdue
export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const today = todayIL();
  const req = (await searchParams).d;
  const date = req && DATE.test(req) && !Number.isNaN(Date.parse(req)) ? req : today;
  const isToday = date === today;
  const [a, g, editor] = await Promise.all([agenda(date, 1), isToday ? taskGroups() : null, eventEditor()]);
  const day = a.days[0];
  const items = toItems(day);
  const link = (d: string) => (d === today ? '/today' : `/today?d=${d}`);

  return (
    <EventEditorProvider editor={editor}>
    <div className="flex flex-col gap-6">
      <PageHeader title={isToday ? 'היום' : long.format(new Date(`${date}T00:00:00Z`))}
        subtitle={isToday ? long.format(new Date(`${date}T00:00:00Z`)) : 'אירועים ומשימות של היום הזה לפי שעה'}
        actions={
          <nav aria-label="מעבר בין ימים" className="flex items-center gap-1">
            <Link href={link(addDays(date, -1))} className={buttonClass('ghost', 'icon')} aria-label="יום קודם"><ChevronRight aria-hidden /></Link>
            {!isToday && <Link href="/today" className={buttonClass('secondary', 'sm')}>היום</Link>}
            <Link href={link(addDays(date, 1))} className={buttonClass('ghost', 'icon')} aria-label="יום הבא"><ChevronLeft aria-hidden /></Link>
            <NewEventButton date={date} className="ms-1" />
          </nav>
        } />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>לפי שעה</CardTitle><span className="shrink-0 text-sm text-muted tabular">{day.events.length} אירועים · {day.tasks.length} משימות</span></CardHeader>
          <CardContent>
            {!a.connected && <CalendarCta configured={a.configured} className="mb-4" />}
            {items.length === 0
              ? <Empty icon={<CalendarDays aria-hidden />} title="היום הזה פנוי">אין אירועים ואין משימות עם התאריך הזה.</Empty>
              : <Timeline items={items} isToday={isToday} />}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>משימות ליום הזה</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <QuickTask path="/today" />
              {day.tasks.length === 0 ? <p className="text-sm text-muted">אין משימות עם התאריך הזה.</p> : (
                <ul className="flex flex-col divide-y divide-[color:var(--border)]">
                  {day.tasks.map(t => <TaskRow key={`${t.source}-${t.id}`} item={t} path="/today" />)}
                </ul>
              )}
            </CardContent>
          </Card>
          {g && (
            <Card>
              <CardHeader><CardTitle>באיחור</CardTitle><Badge tone={g.groups.overdue.length ? 'critical' : 'neutral'} className="tabular">{g.groups.overdue.length}</Badge></CardHeader>
              <CardContent>
                {g.groups.overdue.length === 0 ? <p className="text-sm text-muted">שום דבר לא באיחור.</p> : (
                  <ul className="flex flex-col divide-y divide-[color:var(--border)]">
                    {g.groups.overdue.map(t => <TaskRow key={`${t.source}-${t.id}`} item={t} path="/today" />)}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
          {g && g.groups.waiting.length > 0 && (
            <Card>
              <CardHeader><CardTitle>ממתין למישהו</CardTitle><Badge tone="warning" className="tabular">{g.groups.waiting.length}</Badge></CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y divide-[color:var(--border)]">
                  {g.groups.waiting.map(t => <TaskRow key={`${t.source}-${t.id}`} item={t} path="/today" />)}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
    </EventEditorProvider>
  );
}
