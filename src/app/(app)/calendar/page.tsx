import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { agenda } from '@/server/day';
import { addDays, ilTime, todayIL } from '@/lib/period';
import { Timeline } from '@/components/day/timeline';
import { toItems } from '@/components/day/to-items';
import { CalendarCta } from '@/components/day/calendar-cta';
import { Card, CardContent } from '@/components/ui/card';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const metadata = { title: 'לוח שנה — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const VIEWS = [{ key: 'day', label: 'יום' }, { key: 'week', label: 'שבוע' }, { key: 'month', label: 'חודש' }] as const;
type View = (typeof VIEWS)[number]['key'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const monthFmt = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dowFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'short', timeZone: 'UTC' });
const dmFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const sunday = (d: string) => addDays(d, -utc(d).getUTCDay());   // the Israeli week starts on Sunday
const firstOfMonth = (d: string) => `${d.slice(0, 7)}-01`;
const shiftMonth = (d: string, n: number) => { const x = utc(firstOfMonth(d)); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

// Google Calendar, read-only in stage 1: day, week and month views
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const today = todayIL();
  const view: View = VIEWS.some(v => v.key === sp.view) ? (sp.view as View) : 'week';
  const date = sp.d && DATE.test(sp.d) && !Number.isNaN(Date.parse(sp.d)) ? sp.d : today;

  const start = view === 'day' ? date : view === 'week' ? sunday(date) : sunday(firstOfMonth(date));
  const days = view === 'day' ? 1 : view === 'week' ? 7 : 42;
  const a = await agenda(start, days);
  const prev = view === 'day' ? addDays(date, -1) : view === 'week' ? addDays(date, -7) : shiftMonth(date, -1);
  const next = view === 'day' ? addDays(date, 1) : view === 'week' ? addDays(date, 7) : shiftMonth(date, 1);
  const href = (v: View, d: string) => `/calendar?view=${v}${d === today ? '' : `&d=${d}`}`;
  const title = view === 'day' ? dayFmt.format(utc(date)) : view === 'week'
    ? `${dmFmt.format(utc(start))} – ${dmFmt.format(utc(addDays(start, 6)))}` : monthFmt.format(utc(date));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="תצוגה" className="inline-flex rounded-lg border border-line-strong p-0.5 text-sm">
            {VIEWS.map(v => (
              <Link key={v.key} href={href(v.key, date)} aria-current={v.key === view ? 'true' : undefined}
                className={cn('rounded-md px-3 py-1', v.key === view ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:text-ink')}>{v.label}</Link>
            ))}
          </div>
          <Link href={href(view, prev)} className={buttonClass('ghost', 'icon')} aria-label="הקודם"><ChevronRight className="size-4" /></Link>
          <Link href={href(view, today)} className={buttonClass('secondary', 'sm')}>היום</Link>
          <Link href={href(view, next)} className={buttonClass('ghost', 'icon')} aria-label="הבא"><ChevronLeft className="size-4" /></Link>
        </div>
      </div>
      {!a.connected && <CalendarCta configured={a.configured} />}

      {view === 'day' && (
        <Card><CardContent className="pt-5">
          {toItems(a.days[0]).length === 0 ? <p className="text-sm text-muted">אין אירועים ואין משימות ביום הזה.</p>
            : <Timeline items={toItems(a.days[0])} isToday={date === today} />}
        </CardContent></Card>
      )}

      {view === 'week' && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
          {a.days.map(d => (
            <Card key={d.date} className={cn('min-w-0', d.date === today && 'border-accent')}>
              <CardContent className="flex flex-col gap-2 p-3">
                <Link href={href('day', d.date)} className="flex items-baseline justify-between gap-2 hover:underline">
                  <span className={cn('text-sm font-medium', d.date === today && 'text-accent-ink')}>{dowFmt.format(utc(d.date))}</span>
                  <span className="text-xs text-muted">{dmFmt.format(utc(d.date))}</span>
                </Link>
                <DayList day={d} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {view === 'month' && (
        <Card><CardContent className="p-2 sm:p-3">
          <div className="grid grid-cols-7 gap-px text-center text-xs text-muted" aria-hidden>
            {a.days.slice(0, 7).map(d => <div key={d.date} className="py-1">{dowFmt.format(utc(d.date))}</div>)}
          </div>
          <ol className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-[color:var(--border)]">
            {a.days.map(d => {
              const inMonth = d.date.slice(0, 7) === date.slice(0, 7);
              const n = d.events.length + d.tasks.length;
              return (
                <li key={d.date} className={cn('min-h-20 min-w-0 bg-surface p-1 sm:min-h-24 sm:p-1.5', !inMonth && 'bg-surface-2/60')}>
                  <Link href={href('day', d.date)} aria-label={`${dayFmt.format(utc(d.date))}: ${n} פריטים`}
                    className={cn('mb-1 inline-grid size-6 place-items-center rounded-full text-xs tabular hover:bg-surface-2',
                      d.date === today ? 'bg-accent font-semibold text-white hover:bg-accent' : inMonth ? 'text-ink' : 'text-muted')}>
                    {Number(d.date.slice(8))}
                  </Link>
                  <ul className="hidden flex-col gap-0.5 sm:flex">
                    {d.events.slice(0, 3).map(e => (
                      <li key={e.id} className="truncate rounded px-1 text-[11px] leading-4" style={{ background: 'var(--accent-soft)' }}>
                        <bdi>{e.all_day ? '' : `${ilTime(e.start_at)} `}{e.title || '(ללא כותרת)'}</bdi>
                      </li>
                    ))}
                    {d.tasks.slice(0, Math.max(0, 3 - d.events.length)).map(t => (
                      <li key={t.id} className="truncate px-1 text-[11px] leading-4 text-ink-2"><bdi>☐ {t.title}</bdi></li>
                    ))}
                    {n > 3 && <li className="px-1 text-[11px] text-muted">ועוד {n - 3}</li>}
                  </ul>
                  {n > 0 && <span className="block text-[11px] text-muted sm:hidden tabular">{n}</span>}
                </li>
              );
            })}
          </ol>
        </CardContent></Card>
      )}
    </div>
  );
}

function DayList({ day }: { day: Awaited<ReturnType<typeof agenda>>['days'][number] }) {
  if (day.events.length + day.tasks.length === 0) return <p className="text-xs text-muted">פנוי</p>;
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {day.events.map(e => (
        <li key={e.id} className="rounded-md px-1.5 py-1" style={{ background: 'var(--accent-soft)' }}>
          <span className="block text-muted tabular">{e.all_day ? 'כל היום' : ilTime(e.start_at)}</span>
          <bdi className="line-clamp-2 text-ink">{e.title || '(ללא כותרת)'}</bdi>
        </li>
      ))}
      {day.tasks.map(t => (
        <li key={t.id} className="px-1.5 text-ink-2"><bdi>☐ {t.due_time ? `${t.due_time} ` : ''}{t.title}</bdi></li>
      ))}
    </ul>
  );
}
