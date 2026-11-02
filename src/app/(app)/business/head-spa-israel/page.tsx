import { notFound } from 'next/navigation';
import { requirePlace } from '@/server/auth';
import { workspaceByBranch, workspaceMembers } from '@/server/workspaces';
import { headSpaData, type Basis } from '@/server/headspa';
import { goalsFor, openCounts } from '@/server/entries';
import integrationsLib from '@domain/integrations';
import { CompanyOverview } from '@/components/headspa/company-overview';
import { BasisToggle } from '@/components/ospa/ospa-view';
import { RefreshButton } from '@/components/dash/refresh-button';
import { Tabs, pickTab } from '@/components/shell/tabs';
import { PageHeader } from '@/components/shell/page-header';
import { TaskBoard } from '@/components/work/task-board';
import { GoalsPanel } from '@/components/work/goals-panel';
import { businessModules, toWorkspace } from '@/lib/workspaces';
import { WorkspaceBadge, workspaceTabs } from '@/components/workspace/workspace-ui';
import { BusinessModule } from '@/components/workspace/business-module';

export async function generateMetadata() {
  const w = await workspaceByBranch('business', 'head-spa-israel');
  return { title: `${w?.name ?? 'עסק'} — דשבורד גורזד` };
}
export const dynamic = 'force-dynamic';

const BASE = '/business/head-spa-israel';
const PLACE = { domain: 'business', branch: 'head-spa-israel', location: null } as const;
const MODULES = businessModules(BASE, ['overview', 'tasks', 'goals', 'documents', 'branches', 'members']);
const TABS = MODULES.map(m => m.key);

// Company overview: every branch in the registry (DB `locations`), summed and compared.
// Numbers come from the local tables the integration sync fills; no live Buyz call here.
export default async function HeadSpaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePlace({ domain: 'business', branch: 'head-spa-israel' });
  const w = await workspaceByBranch('business', 'head-spa-israel');
  if (!w) notFound();
  const sp = await searchParams;
  const tab = pickTab(sp.tab, TABS);
  const basis: Basis = sp.basis === 'mine' ? 'mine' : 'all';
  const [d, counts, g, members] = await Promise.all([headSpaData(u, basis), openCounts(), goalsFor(PLACE), workspaceMembers(w, u)]);
  const WS = toWorkspace(w, members.length);
  const anyConnected = d.branches.some(b => b.integration && !['disabled', 'not_connected'].includes(b.integration.status));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.name} subtitle={`כל הסניפים (${d.branches.length}): הכנסות, טיפולים, משימות ויעדים`}
        actions={tab === 'overview' && d.can_see_money ? (
          <>
            <BasisToggle basis={d.basis} share={d.share} base={BASE} />
            {u.isAdmin && anyConnected && <RefreshButton />}
          </>
        ) : undefined}
        status={<WorkspaceBadge ws={WS} />}
        tabs={<Tabs base={BASE} active={tab} tabs={workspaceTabs(MODULES, {
          tasks: counts['business/head-spa-israel']?.open, goals: g.goals.filter(x => x.status === 'active').length,
        })} />} />
      {tab === 'overview' && <CompanyOverview d={d} goals={integrationsLib.goalsProgress(g.goals)} counts={counts} />}
      {tab === 'tasks' && <TaskBoard place={PLACE} path={BASE} title={`משימות ${w.name}`} />}
      {tab === 'goals' && <GoalsPanel place={PLACE} path={BASE} title={`יעדי ${w.name}`} />}
      {!['overview', 'tasks', 'goals'].includes(tab) && <BusinessModule w={w} tab={tab} u={u} modules={MODULES} />}
    </div>
  );
}
