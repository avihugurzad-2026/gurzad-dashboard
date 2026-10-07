import Link from 'next/link';
import { AlertTriangle, CalendarDays, CircleDollarSign, HandCoins, ListChecks } from 'lucide-react';
import { agenda } from '@/server/day';
import { taskGroups, type WorkItem } from '@/server/entries';
import { ils, num } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { monthRevenue, openReceivablesTotal } from '@/server/finance';
import { parseRange, rangeLabel, todayIL } from '@/lib/period';
import { canSeePlace } from '@/server/auth';
import { businessSnapshot, personalSnapshot } from '@/server/snapshot';
import { headSpaSnapshot } from '@/server/headspa';
import { venturesSummary } from '@/server/ventures';
import { HomeFilters, type HomeArea } from '@/components/home/home-filters';
import { BusinessSnapshot, PersonalSnapshot, VenturesSnapshot } from '@/components/home/snapshots';
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

// Head Spa sales come from Buyz (this month and today only); other periods fall back to dashboard rows.
async function headSpaRevenue(u: Awaited<ReturnType<typeof requireUser>>, range: string): Promise<Record<string, { net: number | null; count: number; today: number | null }>> {
  if (range !== 'month' && range !== 'today') return {};
  const h = await headSpaSnapshot(u).catch(() => null);
  if (!h || !h.branches.some(b => b.connected && b.can_see_money)) return {};
  const net = range === 'month' ? h.total.month_ex : h.total.today_ex;
  return { 'head-spa-israel': { net, count: 0, today: h.total.today_ex } };
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const money = u.isOwner || u.memberships.some(m => ['admin', 'manager', 'viewer'].includes(m.role));
  // Global filters: which part of life (only the ones this user may see) and which period
  const areas: HomeArea[] = ['all', ...(['business', 'personal', 'ventures'] as const).filter(d => canSeePlace(u, { domain: d }, 'task'))];
  const area: HomeArea = areas.includes(sp.area as HomeArea) ? sp.area as HomeArea : 'all';
  const range = parseRange(sp.range ?? 'month');
  const periodLabel = rangeLabel(range);
  const showBiz = area === 'all' || area === 'business';
  const showMe = area === 'all' || area === 'personal';
  const showVen = (area === 'all' || area === 'ventures') && canSeePlace(u, { domain: 'ventures' }, 'money');
  const [week, t, rev, owed, biz, me, ven] = await Promise.all([
    agenda(todayIL(), 7), taskGroups(),
    money ? monthRevenue(u) : null, money ? openReceivablesTotal(u) : null,
    showBiz ? headSpaRevenue(u, range).then(ext => businessSnapshot(u, range, ext)) : [], showMe ? personalSnapshot(u, range) : null,
    showVen ? venturesSummary(u).catch(() => null) : null,
  ]);
  const inArea = (i: WorkItem) => area === 'all' || i.domain === area;
  const today = week.days[0];
  const eventsToday = today.events.length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <GreetingClock name={u.name} initial={new Date().toISOString()} />
        <HomeFilters area={area} range={range} areas={areas} />
      </div>

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
        {rev && (
          <KpiCard label="הכנסות החודש עד היום" icon={<CircleDollarSign className="size-4" />} href="/finance"
            value={ils(rev.net)} reason="אין הכנסות עסקיות רשומות החודש"
            hint={rev.gross !== null ? `${ils(rev.gross)} כולל מע״מ · ${rev.count} תנועות` : undefined}
            foot="בלי הכנסות Head Spa מ-Buyz" />
        )}
        {owed && (
          <KpiCard label="גבייה פתוחה" icon={<HandCoins className="size-4" />} href="/business/adigital?tab=collections"
            value={ils(owed.total)} reason="אין חובות פתוחים"
            hint={owed.overdue_count ? `${owed.overdue_count} באיחור` : `${owed.dashboard_count + owed.vault_count} פתוחים, כולל מע״מ`} />
        )}
      </div>

      {biz.length > 0 && <BusinessSnapshot cards={biz} periodLabel={periodLabel} />}
      {me && <PersonalSnapshot card={me} periodLabel={periodLabel}
        events={week.connected ? week.days.reduce((a, d) => a + d.events.length, 0) : null} />}
      {ven?.ready && <VenturesSnapshot s={ven} />}

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
          const items: WorkItem[] = t.groups[g.key].filter(inArea);
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
