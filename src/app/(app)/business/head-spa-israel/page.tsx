import { requirePlace } from '@/server/auth';
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

export const metadata = { title: 'Head Spa Israel — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const BASE = '/business/head-spa-israel';
const PLACE = { domain: 'business', branch: 'head-spa-israel', location: null } as const;
const TABS = ['overview', 'tasks', 'goals'] as const;

// Company overview: every branch in the registry (DB `locations`), summed and compared.
// Numbers come from the local tables the integration sync fills; no live Buyz call here.
export default async function HeadSpaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePlace({ domain: 'business', branch: 'head-spa-israel' });
  const sp = await searchParams;
  const tab = pickTab(sp.tab, TABS);
  const basis: Basis = sp.basis === 'mine' ? 'mine' : 'all';
  const [d, counts, g] = await Promise.all([headSpaData(u, basis), openCounts(), goalsFor(PLACE)]);
  const anyConnected = d.branches.some(b => b.integration && !['disabled', 'not_connected'].includes(b.integration.status));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Head Spa Israel" subtitle={`כל הסניפים (${d.branches.length}): הכנסות, טיפולים, משימות ויעדים`}
        actions={tab === 'overview' && d.can_see_money ? (
          <>
            <BasisToggle basis={d.basis} share={d.share} base={BASE} />
            {u.isAdmin && anyConnected && <RefreshButton />}
          </>
        ) : undefined}
        tabs={<Tabs base={BASE} active={tab} tabs={[
          { key: 'overview', label: 'סקירה' },
          { key: 'tasks', label: 'משימות', count: counts['business/head-spa-israel']?.open },
          { key: 'goals', label: 'יעדים', count: g.goals.filter(x => x.status === 'active').length },
        ]} />} />
      {tab === 'overview' && <CompanyOverview d={d} goals={integrationsLib.goalsProgress(g.goals)} counts={counts} />}
      {tab === 'tasks' && <TaskBoard place={PLACE} path={BASE} title="משימות Head Spa Israel" />}
      {tab === 'goals' && <GoalsPanel place={PLACE} path={BASE} title="יעדי Head Spa Israel" />}
    </div>
  );
}
