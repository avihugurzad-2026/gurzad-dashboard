import { notFound } from 'next/navigation';
import { ListChecks, Target } from 'lucide-react';
import { requireUser, canSeePlace } from '@/server/auth';
import { branchesOf, canOpenWorkspace, workspaceByBranch } from '@/server/workspaces';
import { goalsFor, openCounts } from '@/server/entries';
import { num } from '@/lib/format';
import { KpiCard } from '@/components/dash/kpi-card';
import { Tabs, pickTab } from '@/components/shell/tabs';
import { PageHeader } from '@/components/shell/page-header';
import { TaskBoard } from '@/components/work/task-board';
import { GoalsPanel } from '@/components/work/goals-panel';
import { Badge } from '@/components/ui/badge';
import { WorkspaceDocuments } from '@/components/workspace/workspace-documents';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9-]{1,40}$/;
const TABS = [
  { key: 'overview', label: 'סקירה' }, { key: 'tasks', label: 'משימות' }, { key: 'goals', label: 'יעדים' }, { key: 'documents', label: 'מסמכים' },
] as const;

async function find(branch: string, location: string) {
  if (!SLUG.test(branch) || !SLUG.test(location)) return null;
  const w = await workspaceByBranch('business', branch);
  if (!w) return null;
  const b = (await branchesOf(w)).find(x => x.id === location && x.active);
  return b ? { w, b } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ branch: string; location: string }> }) {
  const { branch, location } = await params;
  const f = await find(branch, location);
  return { title: f ? `${f.b.name} · ${f.w.name} — דשבורד גורזד` : 'סניף — דשבורד גורזד' };
}

// One branch of a business created from the UI: its own tasks, goals and documents
export default async function BusinessBranchPage({ params, searchParams }: {
  params: Promise<{ branch: string; location: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ branch, location }, sp] = await Promise.all([params, searchParams]);
  const u = await requireUser();
  const f = await find(branch, location);
  if (!f || !canOpenWorkspace(u, f.w) || !canSeePlace(u, { domain: 'business', branch, location })) notFound();
  const { w, b } = f;
  const base = `/business/${branch}/${location}`;
  const tab = pickTab(sp.tab, TABS.map(t => t.key));
  const place = { domain: 'business', branch, location } as const;
  const [counts, g] = await Promise.all([openCounts(), goalsFor(place)]);
  const open = counts[`business/${branch}/${location}`];
  const activeGoals = g.goals.filter(x => x.status === 'active').length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={b.name} subtitle={<>סניף של <bdi>{w.name}</bdi></>}
        status={b.status === 'setup' ? <Badge tone="warning">בהקמה</Badge> : undefined}
        tabs={<Tabs base={base} active={tab} tabs={TABS.map(t => ({ key: t.key, label: t.label,
          count: t.key === 'tasks' ? open?.open ?? null : t.key === 'goals' ? activeGoals || null : null }))} />} />
      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <KpiCard label="משימות פתוחות" icon={<ListChecks className="size-4" />} amount={false} href={`${base}?tab=tasks`}
              value={open ? num(open.open) : null} hint={open?.overdue ? `${open.overdue} באיחור` : undefined} reason="אין משימות פתוחות בסניף" />
            <KpiCard label="יעדים פעילים" icon={<Target className="size-4" />} amount={false} href={`${base}?tab=goals`}
              value={activeGoals ? num(activeGoals) : null} reason="עוד לא הוגדרו יעדים לסניף" />
          </div>
          <TaskBoard place={place} path={base} title={`משימות ${b.name}`} />
        </>
      )}
      {tab === 'tasks' && <TaskBoard place={place} path={base} title={`משימות ${b.name}`} />}
      {tab === 'goals' && <GoalsPanel place={place} path={base} title={`יעדי ${b.name}`} />}
      {tab === 'documents' && <WorkspaceDocuments u={u} place={place} path={base} title={`מסמכי ${b.name}`} />}
    </div>
  );
}
