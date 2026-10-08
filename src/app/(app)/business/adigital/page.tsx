import { HandCoins, ListChecks, Target, TrendingUp, Users } from 'lucide-react';
import { finance } from '@/server/data';
import { goalsFor, openCounts } from '@/server/entries';
import { ils, num } from '@/lib/format';
import { KpiCard } from '@/components/dash/kpi-card';
import { RetainersTable } from '@/components/dash/finance-tables';
import { ReceivablesTable } from '@/components/finance/receivables-table';
import { parseReceivableFilter, receivables } from '@/server/finance';
import { requirePlace } from '@/server/auth';
import { notFound } from 'next/navigation';
import { workspaceByBranch, workspaceMembers } from '@/server/workspaces';
import { Tabs, pickTab } from '@/components/shell/tabs';
import { PageHeader } from '@/components/shell/page-header';
import { TaskBoard } from '@/components/work/task-board';
import { GoalsPanel } from '@/components/work/goals-panel';
import { businessModules, toWorkspace } from '@/lib/workspaces';
import { WorkspaceBadge, workspaceTabs } from '@/components/workspace/workspace-ui';
import { BusinessModule } from '@/components/workspace/business-module';

export async function generateMetadata() {
  const w = await workspaceByBranch('business', 'adigital');
  return { title: `${w?.name ?? 'עסק'} — דשבורד גורזד` };
}
export const dynamic = 'force-dynamic';

const BASE = '/business/adigital';
const PLACE = { domain: 'business', branch: 'adigital', location: null } as const;
const MODULES = businessModules(BASE, ['overview', 'tasks', 'clients', 'collections', 'goals', 'documents', 'branches', 'members']);
const TABS = MODULES.map(m => m.key);

export default async function AdigitalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tab = pickTab(sp.tab, TABS);
  const u = await requirePlace({ domain: 'business', branch: 'adigital' });
  const w = await workspaceByBranch('business', 'adigital');
  if (!w) notFound();
  const rf = parseReceivableFilter(sp.rf);
  const [d, counts, g, rec, members] = await Promise.all([finance('adigital'), openCounts(), goalsFor(PLACE), receivables(u, rf, PLACE), workspaceMembers(w, u)]);
  const WS = toWorkspace(w, members.length);
  // Money owed: dashboard receivables (open part) + open vault debts. null only when neither has anything.
  const owed = rec.open_total === null && d.debt_total === null ? null : (rec.open_total ?? 0) + (d.debt_total ?? 0);
  const openRec = rec.counts.all - rec.counts.paid;
  const collections = (tabKey: string) => (
    <ReceivablesTable d={rec} vault={d} base={BASE} place="business|adigital|" extraQuery={`tab=${tabKey}`} />
  );
  const open = counts['business/adigital'];
  const activeGoals = g.goals.filter(x => x.status === 'active').length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.name} subtitle="לקוחות, גבייה, משימות ויעדים · הכנסה ללא מע״מ, יתרות לגבייה כולל מע״מ"
        status={<WorkspaceBadge ws={WS} />}
        tabs={<Tabs base={BASE} active={tab} tabs={workspaceTabs(MODULES, {
          tasks: open?.open, clients: d.retainers.length, collections: openRec + d.debts.length, goals: activeGoals,
        })} />} />

      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="הכנסה חודשית קבועה" icon={<TrendingUp className="size-4" />} value={ils(d.mrr)} href={`${BASE}?tab=clients`}
              hint={d.mrr_gross !== null ? `${ils(d.mrr_gross)} כולל מע״מ` : undefined} reason="אין ריטיינרים פעילים" />
            <KpiCard label="כסף שמחכה לגבייה" icon={<HandCoins className="size-4" />} value={ils(owed)} href={`${BASE}?tab=collections`}
              hint={`${openRec + d.debts.length} יתרות${rec.counts.overdue ? ` · ${rec.counts.overdue} באיחור` : ''}`} reason="אין יתרות פתוחות" />
            <KpiCard label="לקוחות פעילים" icon={<Users className="size-4" />} amount={false} href={`${BASE}?tab=clients`}
              value={d.retainers.length ? num(d.retainers.length) : null}
              hint={d.concentration ? `הלקוח הגדול: ${d.concentration.max_pct}% מההכנסה` : undefined} reason="אין ריטיינרים פעילים" />
            <KpiCard label="משימות פתוחות" icon={<ListChecks className="size-4" />} amount={false} href={`${BASE}?tab=tasks`}
              value={num(open?.open ?? 0)} hint={open?.overdue ? `${open.overdue} באיחור` : undefined}
              reason="אין משימות פתוחות"
              foot={<span className="inline-flex items-center gap-1.5"><Target className="size-4" aria-hidden />{activeGoals ? `${activeGoals} יעדים פעילים` : 'עוד אין יעדים'}</span>} />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
            <TaskBoard place={PLACE} path={BASE} title={`משימות ${w.name}`} />
            {collections('overview')}
          </div>
        </>
      )}
      {tab === 'tasks' && <TaskBoard place={PLACE} path={BASE} title={`משימות ${w.name}`} />}
      {tab === 'clients' && <RetainersTable d={d} />}
      {tab === 'collections' && collections('collections')}
      {tab === 'goals' && <GoalsPanel place={PLACE} path={BASE} title={`יעדי ${w.name}`} />}
      {['finance', 'documents', 'reports', 'branches', 'members'].includes(tab) && <BusinessModule w={w} tab={tab} u={u} modules={MODULES} />}
    </div>
  );
}
