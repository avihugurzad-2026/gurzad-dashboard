import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ListChecks, MapPin, Settings2, Target, Users } from 'lucide-react';
import { requireUser } from '@/server/auth';
import { branchesOf, canManageWorkspace, canOpenWorkspace, workspaceByBranch, workspaceMembers } from '@/server/workspaces';
import { goalsFor, openCounts } from '@/server/entries';
import { num } from '@/lib/format';
import { businessModules, toWorkspace } from '@/lib/workspaces';
import { KpiCard } from '@/components/dash/kpi-card';
import { Tabs, pickTab } from '@/components/shell/tabs';
import { PageHeader } from '@/components/shell/page-header';
import { TaskBoard } from '@/components/work/task-board';
import { GoalsPanel } from '@/components/work/goals-panel';
import { buttonClass } from '@/components/ui/button';
import { WorkspaceBadge, workspaceTabs } from '@/components/workspace/workspace-ui';
import { BusinessModule } from '@/components/workspace/business-module';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9-]{1,40}$/;
// Tabs that show real data on a business created from the UI; the rest say what will be there
const READY = ['overview', 'tasks', 'goals', 'documents', 'branches', 'members'];

export async function generateMetadata({ params }: { params: Promise<{ branch: string }> }) {
  const { branch } = await params;
  const w = SLUG.test(branch) ? await workspaceByBranch('business', branch) : null;
  return { title: `${w?.name ?? 'עסק'} — דשבורד גורזד` };
}

// Any business created from the UI. (Businesses with their own folder under /business take precedence.)
export default async function BusinessPage({ params, searchParams }: {
  params: Promise<{ branch: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ branch }, sp] = await Promise.all([params, searchParams]);
  if (!SLUG.test(branch)) notFound();
  const u = await requireUser();
  const w = await workspaceByBranch('business', branch);
  if (!w || !canOpenWorkspace(u, w)) notFound();
  const base = `/business/${branch}`;
  const modules = businessModules(base, READY);
  const tab = pickTab(sp.tab, modules.map(m => m.key));
  const place = { domain: 'business', branch, location: null } as const;
  const [members, counts, g, branches] = await Promise.all([workspaceMembers(w, u), openCounts(), goalsFor(place), branchesOf(w)]);
  const open = counts[`business/${branch}`];
  const activeGoals = g.goals.filter(x => x.status === 'active').length;
  const active = branches.filter(b => b.active);
  const ws = toWorkspace(w, members.length);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.name} subtitle="משימות, יעדים, מסמכים, סניפים וצוות של העסק" status={<WorkspaceBadge ws={ws} />}
        actions={canManageWorkspace(u, w) ? <Link href="/workspaces" className={buttonClass('secondary', 'md')}><Settings2 aria-hidden />ניהול העסק</Link> : undefined}
        tabs={<Tabs base={base} active={tab} tabs={workspaceTabs(modules, {
          tasks: open?.open, goals: activeGoals || null, branches: active.length || null, members: members.length || null,
        })} />} />

      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <KpiCard label="משימות פתוחות" icon={<ListChecks className="size-4" />} amount={false} href={`${base}?tab=tasks`}
              value={open ? num(open.open) : null} hint={open?.overdue ? `${open.overdue} באיחור` : undefined} reason="אין משימות פתוחות" />
            <KpiCard label="יעדים פעילים" icon={<Target className="size-4" />} amount={false} href={`${base}?tab=goals`}
              value={activeGoals ? num(activeGoals) : null} reason="עוד לא הוגדרו יעדים" />
            <KpiCard label="סניפים" icon={<MapPin className="size-4" />} amount={false} href={`${base}?tab=branches`}
              value={active.length ? num(active.length) : null} reason="עוד לא נוספו סניפים" />
            <KpiCard label="חברי צוות" icon={<Users className="size-4" />} amount={false} href={`${base}?tab=members`}
              value={members.length ? num(members.length) : null} reason="עוד לא הוזמנו חברים" />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
            <TaskBoard place={place} path={base} title={`משימות ${w.name}`} />
            <GoalsPanel place={place} path={base} title={`יעדי ${w.name}`} />
          </div>
        </>
      )}
      {tab === 'tasks' && <TaskBoard place={place} path={base} title={`משימות ${w.name}`} />}
      {tab === 'goals' && <GoalsPanel place={place} path={base} title={`יעדי ${w.name}`} />}
      {!['overview', 'tasks', 'goals'].includes(tab) && <BusinessModule w={w} tab={tab} u={u} modules={modules} />}
    </div>
  );
}
