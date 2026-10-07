import Link from 'next/link';
import { AlertTriangle, CalendarDays, CircleDollarSign, HandCoins, ListChecks } from 'lucide-react';
import { agenda } from '@/server/day';
import { taskGroups, type WorkItem } from '@/server/entries';
import { num } from '@/lib/format';
import { todayIL } from '@/lib/period';
import { KpiCard } from '@/components/dash/kpi-card';
import { GreetingClock } from '@/components/day/clock';
import { Timeline } from '@/components/day/timeline';
import { toItems } from '@/components/day/to-items';
import { WeekStrip } from '@/components/day/week-strip';
import { CalendarCta } from '@/components/day/calendar-cta';
import { QuickTask } from '@/components/work/quick-task';
import { TaskRow } from '@/components/work/task-row';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';

export const metadata = { title: 'בית — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const GROUPS = [
  { key: 'attention', title: 'דורש טיפול', empty: 'אין משימות דחופות פתוחות' },
  { key: 'overdue', title: 'באיחור', empty: 'שום דבר לא באיחור' },
  { key: 'today', title: 'היום', empty: 'אין משימות עם תאריך של היום' },
  { key: 'waiting', title: 'ממתין למישהו', empty: 'אין משימות שממתינות לאחרים' },
] as const;

export default async function HomePage() {
  const [week, t] = await Promise.all([agenda(todayIL(), 7), taskGroups()]);
  const today = week.days[0];
  const eventsToday = today.events.length;

  return (
    <div className="flex flex-col gap-5">
      <GreetingClock name="אביהו" initial={new Date().toISOString()} />

      <Card>
        <CardContent className="pt-4">
          <QuickTask path="/" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard label="משימות דחופות" icon={<ListChecks className="size-4" />} amount={false} href="#tasks"
          value={t.ready ? num(t.urgent) : null} reason="טבלת המשימות עוד לא זמינה"
          hint={t.overdue_count ? `${t.overdue_count} באיחור` : 'שום דבר לא באיחור'} />
        <KpiCard label="פגישות ואירועים היום" icon={<CalendarDays className="size-4" />} amount={false} href="/today"
          value={week.connected ? num(eventsToday) : null}
          reason={week.configured ? 'יומן Google עוד לא חובר' : 'חיבור ליומן Google עוד לא הוגדר'}
          hint={week.connected ? (eventsToday ? undefined : 'יום פנוי ביומן') : undefined} />
        <KpiCard label="הכנסות החודש עד היום" icon={<CircleDollarSign className="size-4" />} value={null} reason="יגיע בשלב 2"
          foot={<Link href="/business/head-spa-israel" className="hover:underline">בינתיים: הכנסות Head Spa מ-Buyz</Link>} />
        <KpiCard label="גבייה פתוחה" icon={<HandCoins className="size-4" />} value={null} reason="יגיע בשלב 2"
          foot={<Link href="/business/adigital?tab=collections" className="hover:underline">בינתיים: גבייה ב-a-digital</Link>} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>היום שלי</CardTitle><Link href="/today" className="text-sm text-accent hover:underline">לוח היום</Link></CardHeader>
          <CardContent>
            {!week.connected && <CalendarCta configured={week.configured} className="mb-3" />}
            {toItems(today).length === 0 ? (
              <Empty icon={<CalendarDays className="size-6" />} title="אין אירועים ומשימות עם שעה להיום">
                משימה עם תאריך של היום, או פגישה ביומן, תופיע כאן לפי השעה.
              </Empty>
            ) : <Timeline items={toItems(today)} isToday />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>השבוע הקרוב</CardTitle><Link href="/calendar?view=week" className="text-sm text-accent hover:underline">לוח שנה</Link></CardHeader>
          <CardContent><WeekStrip days={week.days} today={week.today} connected={week.connected} /></CardContent>
        </Card>
      </div>

      <section id="tasks" aria-label="משימות" className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {GROUPS.map(g => {
          const items: WorkItem[] = t.groups[g.key];
          return (
            <Card key={g.key}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {g.key === 'overdue' && items.length > 0 && <AlertTriangle className="size-4 text-critical" aria-hidden />}{g.title}
                </CardTitle>
                <span className="text-sm text-muted">{items.length}</span>
              </CardHeader>
              <CardContent>
                {items.length === 0 ? <p className="text-sm text-muted">{g.empty}</p> : (
                  <ul className="flex flex-col divide-y divide-[color:var(--border)]">
                    {items.slice(0, 8).map(i => <TaskRow key={`${i.source}-${i.id}`} item={i} path="/" />)}
                  </ul>
                )}
                {items.length > 8 && <p className="pt-2 text-xs text-muted">ועוד {items.length - 8}</p>}
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
