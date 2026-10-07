import { notFound } from 'next/navigation';
import { requirePlace } from '@/server/auth';
import { headSpaData, type Basis } from '@/server/headspa';
import { loadLocations } from '@/server/locations';
import { goalsFor, openCounts } from '@/server/entries';
import { location as findLocation } from '@/lib/places';
import integrationsLib from '@domain/integrations';
import { BranchDashboard, BRANCH_TABS } from '@/components/headspa/branch-dashboard';
import { pickTab } from '@/components/shell/tabs';

export const dynamic = 'force-dynamic';

const ENTITY = 'head-spa-israel';

export async function generateMetadata({ params }: { params: Promise<{ location: string }> }) {
  const { location } = await params;
  await loadLocations();
  const l = findLocation(ENTITY, location);
  return { title: `סניף ${l?.label ?? ''} — Head Spa Israel` };
}

// One branch, by branch id. Every branch (Modiin, Jerusalem, any branch added to `locations`)
// renders the same BranchDashboard with its own data; there is no per-branch code.
export default async function BranchPage({ params, searchParams }: {
  params: Promise<{ location: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ location }, sp] = await Promise.all([params, searchParams]);
  if (!/^[a-z0-9-]{1,40}$/.test(location)) notFound();
  await loadLocations();
  if (!findLocation(ENTITY, location)) notFound();
  const u = await requirePlace({ domain: 'business', branch: ENTITY, location });
  const tab = pickTab(sp.tab, BRANCH_TABS);
  const basis: Basis = sp.basis === 'mine' ? 'mine' : 'all';
  const place = { domain: 'business', branch: ENTITY, location } as const;
  const [d, counts, g] = await Promise.all([headSpaData(u, basis, location), openCounts(), goalsFor(place)]);
  const b = d.branches[0];
  if (!b) notFound();
  return (
    <BranchDashboard d={d} b={b} tab={tab} goals={integrationsLib.goalsProgress(g.goals)} canRefresh={u.isAdmin}
      counts={{ tasks: counts[`business/${ENTITY}/${location}`]?.open, goals: g.goals.filter(x => x.status === 'active').length }} />
  );
}
