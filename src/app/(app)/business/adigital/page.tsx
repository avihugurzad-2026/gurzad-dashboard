import { HandCoins, ListChecks, Target, TrendingUp, Users } from 'lucide-react';
import { finance } from '@/server/data';
import { goalsFor, openCounts } from '@/server/entries';
import { ils, num } from '@/lib/format';
import { KpiCard } from '@/components/dash/kpi-card';
import { DebtsTable, RetainersTable } from '@/components/dash/finance-tables';
import { Tabs, pickTab } from '@/components/shell/tabs';
import { TaskBoard } from '@/components/work/task-board';
import { GoalsPanel } from '@/components/work/goals-panel';

export const metadata = { title: 'a-digital — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const BASE = '/business/adigital';
const PLACE = { domain: 'business', branch: 'adigital', location: null } as const;
const TABS = ['overview', 'tasks', 'clients', 'collections', 'goals'] as const;

export default async function AdigitalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tab = pickTab((await searchParams).tab, TABS);
  const [d, counts, g] = await Promise.all([finance('adigital'), openCounts(), goalsFor(PLACE)]);
  const open = counts['business/adigital'];
  const activeGoals = g.goals.filter(x => x.status === 'active').length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold"><bdi>a-digital</bdi></h1>
        <p className="text-sm text-muted">עסקים · הכנסה ללא מע״מ, יתרות לגבייה כולל מע״מ</p>
      </div>
      <Tabs base={BASE} active={tab} tabs={[
        { key: 'overview', label: 'סקירה' },
        { key: 'tasks', label: 'משימות', count: open?.open },
        { key: 'clients', label: 'לקוחות', count: d.retainers.length },
        { key: 'collections', label: 'גבייה', count: d.debts.length },
        { key: 'goals', label: 'יעדים', count: activeGoals },
      ]} />

      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="הכנסה חודשית קבועה" icon={<TrendingUp className="size-4" />} value={ils(d.mrr)} href={`${BASE}?tab=clients`}
              hint={d.mrr_gross !== null ? `${ils(d.mrr_gross)} כולל מע״מ` : undefined} reason="אין ריטיינרים פעילים" />
            <KpiCard label="כסף שמחכה לגבייה" icon={<HandCoins className="size-4" />} value={ils(d.debt_total)} href={`${BASE}?tab=collections`}
              hint={`${d.debts.length} יתרות`} reason="אין יתרות פתוחות" />
            <KpiCard label="לקוחות פעילים" icon={<Users className="size-4" />} amount={false} href={`${BASE}?tab=clients`}
              value={d.retainers.length ? num(d.retainers.length) : null}
              hint={d.concentration ? `הלקוח הגדול: ${d.concentration.max_pct}% מההכנסה` : undefined} reason="אין ריטיינרים פעילים" />
            <KpiCard label="משימות פתוחות" icon={<ListChecks className="size-4" />} amount={false} href={`${BASE}?tab=tasks`}
              value={num(open?.open ?? 0)} hint={open?.overdue ? `${open.overdue} באיחור` : undefined}
              reason="אין משימות פתוחות"
              foot={<span className="inline-flex items-center gap-1"><Target className="size-3.5" aria-hidden />{activeGoals ? `${activeGoals} יעדים פעילים` : 'עוד אין יעדים'}</span>} />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
            <TaskBoard place={PLACE} path={BASE} title="משימות a-digital" />
            <DebtsTable d={d} />
          </div>
        </>
      )}
      {tab === 'tasks' && <TaskBoard place={PLACE} path={BASE} title="משימות a-digital" />}
      {tab === 'clients' && <RetainersTable d={d} />}
      {tab === 'collections' && <DebtsTable d={d} />}
      {tab === 'goals' && <GoalsPanel place={PLACE} path={BASE} title="יעדי a-digital" />}
    </div>
  );
}
