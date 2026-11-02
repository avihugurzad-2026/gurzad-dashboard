import Link from 'next/link';
import { Briefcase, ChevronLeft, Lock, MapPin, Rocket, Sofa, UserRound } from 'lucide-react';
import { requireUser, type SessionUser } from '@/server/auth';
import {
  branchesOf, canManageWorkspace, currentHousehold, myWorkspaces, roleIn, workspaceMembers, type WorkspaceRow,
} from '@/server/workspaces';
import { switchHousehold } from '@/app/workspace-actions';
import { KIND_LABEL, hrefOf, type WorkspaceKind } from '@/lib/workspaces';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Section } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import {
  AddBranchDialog, ArchiveBranchButton, ArchiveWorkspaceButton, BranchStatusSelect, CreateWorkspaceDialog, RenameDialog,
} from '@/components/workspace/workspace-forms';
import { roleLabel } from '@/components/workspace/role-label';

export const metadata = { title: 'ניהול אזורים — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const ICON: Record<WorkspaceKind, React.ReactNode> = {
  personal: <UserRound aria-hidden />, household: <Sofa aria-hidden />, business: <Briefcase aria-hidden />, ventures: <Rocket aria-hidden />,
};
const GROUPS: { kind: WorkspaceKind; title: string }[] = [
  { kind: 'personal', title: 'אישי' }, { kind: 'household', title: 'משקי בית' }, { kind: 'business', title: 'עסקים' }, { kind: 'ventures', title: 'יזמות' },
];

type Row = { w: WorkspaceRow; members: number; branches: Awaited<ReturnType<typeof branchesOf>> };

// Every workspace the user belongs to, by kind: create, rename and archive households and businesses,
// and manage each business's branches. Archiving keeps all data (soft delete).
export default async function WorkspacesPage() {
  const u = await requireUser();
  const [mine, hh] = await Promise.all([myWorkspaces(u), currentHousehold(u)]);
  const rows: Row[] = await Promise.all(mine.map(async w => ({
    w,
    members: w.kind === 'personal' ? 1 : (await workspaceMembers(w, u)).length,
    branches: w.kind === 'business' ? (await branchesOf(w)).filter(b => b.active) : [],
  })));
  const of = (k: WorkspaceKind) => rows.filter(r => r.w.kind === k);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="ניהול אזורים" subtitle="משקי הבית והעסקים שלך: יצירה, שינוי שם, סניפים וארכיון"
        actions={<><CreateWorkspaceDialog kind="household" /><CreateWorkspaceDialog kind="business" primary /></>} />

      {GROUPS.map(g => {
        const list = of(g.kind);
        if (g.kind === 'ventures' && list.length === 0) return null;
        return (
          <Section key={g.kind} title={g.title}>
            {list.length === 0 ? (
              <Card>
                <Empty compact icon={g.kind === 'household' ? <Sofa aria-hidden /> : <Briefcase aria-hidden />}
                  title={g.kind === 'household' ? 'עוד אין לך משק בית' : g.kind === 'business' ? 'עוד אין עסקים' : 'אין אזור אישי'}>
                  {g.kind === 'household' && <div className="flex flex-col items-center gap-3"><span>משק בית משותף למשפחה. האזור האישי של כל אחד נשאר פרטי.</span><CreateWorkspaceDialog kind="household" primary /></div>}
                  {g.kind === 'business' && <div className="flex flex-col items-center gap-3"><span>צור עסק, ואחר כך הוסף לו סניפים וחברי צוות.</span><CreateWorkspaceDialog kind="business" primary /></div>}
                </Empty>
              </Card>
            ) : (
              <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
                {list.map(r => <li key={r.w.id}><WorkspaceCard r={r} u={u} current={r.w.id === hh?.id} households={of('household').length} /></li>)}
              </ul>
            )}
          </Section>
        );
      })}
    </div>
  );
}

function WorkspaceCard({ r, u, current, households }: { r: Row; u: SessionUser; current: boolean; households: number }) {
  const { w } = r;
  const role = roleIn(u, w);
  const manage = w.kind !== 'personal' && canManageWorkspace(u, w);
  const open = w.kind === 'household' && !current && households > 1 ? (
    <form action={switchHousehold}>
      <input type="hidden" name="ws" value={w.id} />
      <button type="submit" className={buttonClass('secondary', 'sm')}>פתח<ChevronLeft aria-hidden /></button>
    </form>
  ) : <Link href={hrefOf(w)} className={buttonClass('secondary', 'sm')}>פתח<ChevronLeft aria-hidden /></Link>;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-muted [&_svg]:size-[18px]">{ICON[w.kind]}</span><bdi>{w.name}</bdi>
          {current && households > 1 && <Badge tone="accent">המוצג עכשיו</Badge>}
        </CardTitle>
        {open}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone="neutral">{KIND_LABEL[w.kind]}</Badge>
          {w.kind === 'personal'
            ? <Badge tone="neutral"><Lock aria-hidden />פרטי · רק אתה</Badge>
            : <>
                {role && <Badge tone={role === 'owner' ? 'accent' : 'neutral'}>{roleLabel(role, w.kind)}</Badge>}
                <span>{r.members === 1 ? 'חבר אחד' : `${r.members} חברים`}</span>
              </>}
        </div>
        {w.kind === 'personal' && <p className="text-sm text-muted">האזור האישי שלך. אף אחד אחר לא רואה אותו, והוא לא ניתן לשיתוף או לארכיון.</p>}

        {w.kind === 'business' && <Branches r={r} manage={manage} />}

        {manage && (w.kind === 'household' || w.kind === 'business') && (
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <RenameDialog ws={w.id} name={w.name} label={`שינוי שם: ${w.name}`} />
            <Link href={w.kind === 'household' ? '/household/members' : `${hrefOf(w)}?tab=members`} className={buttonClass('ghost', 'sm')}>חברים והזמנות</Link>
            <span className="flex-1" />
            <ArchiveWorkspaceButton ws={w.id} name={w.name} kind={w.kind} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Branches({ r, manage }: { r: Row; manage: boolean }) {
  const { w, branches } = r;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink-2">סניפים</p>
        {manage && branches.length > 0 && <AddBranchDialog ws={w.id} />}
      </div>
      {branches.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2/60 px-3 py-3 text-sm text-muted">
          <span>אין סניפים עדיין. עסק עם מקום אחד לא צריך סניפים.</span>
          {manage && <AddBranchDialog ws={w.id} />}
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-[color:var(--border)]">
          {branches.map(b => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <Link href={`${hrefOf(w)}/${b.id}`} className="flex items-center gap-2 text-body text-ink hover:underline">
                <MapPin className="size-4 text-muted" aria-hidden /><bdi>{b.name}</bdi>
              </Link>
              {manage ? (
                <span className="flex items-center gap-1">
                  <BranchStatusSelect ws={w.id} location={b.id} status={b.status} name={b.name} />
                  <RenameDialog ws={w.id} location={b.id} name={b.name} label={`שינוי שם: ${b.name}`} />
                  <ArchiveBranchButton ws={w.id} location={b.id} name={b.name} />
                </span>
              ) : b.status === 'setup' ? <Badge tone="warning">בהקמה</Badge> : <Badge tone="good">פעיל</Badge>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
