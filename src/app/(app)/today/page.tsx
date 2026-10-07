import Link from 'next/link';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { agenda } from '@/server/day';
import { taskGroups } from '@/server/entries';
import { addDays, todayIL } from '@/lib/period';
import { Timeline } from '@/components/day/timeline';
import { toItems } from '@/components/day/to-items';
import { CalendarCta } from '@/components/day/calendar-cta';
import { QuickTask } from '@/components/work/quick-task';
import { TaskRow } from '@/components/work/task-row';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { buttonClass } from '@/components/ui/button';

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
  const [a, g] = await Promise.all([agenda(date, 1), isToday ? taskGroups() : null]);
  const day = a.days[0];
  const items = toItems(day);
  const link = (d: string) => (d === today ? '/today' : `/today?d=${d}`);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">{isToday ? 'היום' : long.format(new Date(`${date}T00:00:00Z`))}</h1>
          {isToday && <p className="text-sm text-muted">{long.format(new Date(`${date}T00:00:00Z`))}</p>}
        </div>
        <nav aria-label="מעבר בין ימים" className="flex items-center gap-1">
          <Link href={link(addDays(date, -1))} className={buttonClass('ghost', 'icon')} aria-label="יום קודם"><ChevronRight className="size-4" /></Link>
          {!isToday && <Link href="/today" className={buttonClass('secondary', 'sm')}>היום</Link>}
          <Link href={link(addDays(date, 1))} className={buttonClass('ghost', 'icon')} aria-label="יום הבא"><ChevronLeft className="size-4" /></Link>
        </nav>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>לפי שעה</CardTitle><span className="text-sm text-muted">{day.events.length} אירועים · {day.tasks.length} משימות</span></CardHeader>
          <CardContent>
            {!a.connected && <CalendarCta configured={a.configured} className="mb-3" />}
            {items.length === 0
              ? <Empty icon={<CalendarDays className="size-6" />} title="היום הזה פנוי">אין אירועים ואין משימות עם התאריך הזה.</Empty>
              : <Timeline items={items} isToday={isToday} />}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle>משימות ליום הזה</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
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
              <CardHeader><CardTitle>באיחור</CardTitle><span className="text-sm text-muted">{g.groups.overdue.length}</span></CardHeader>
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
              <CardHeader><CardTitle>ממתין למישהו</CardTitle><span className="text-sm text-muted">{g.groups.waiting.length}</span></CardHeader>
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
  );
}
