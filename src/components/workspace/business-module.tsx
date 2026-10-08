import Link from 'next/link';
import { ChevronLeft, MapPin } from 'lucide-react';
import { canSeePlace, type SessionUser } from '@/server/auth';
import { branchesOf, canManageWorkspace, type WorkspaceRow } from '@/server/workspaces';
import { encodePlace } from '@/lib/places';
import { hrefOf, moduleOf, type WorkspaceModule } from '@/lib/workspaces';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { ModulePlaceholder } from './workspace-ui';
import { WorkspaceDocuments } from './workspace-documents';
import { MembersPanel } from './members-panel';
import { AddBranchDialog, ArchiveBranchButton, BranchStatusSelect, RenameDialog } from './workspace-forms';

// The business tabs that are the same for every business: documents (scoped to the business),
// branches, members, and placeholders that point to where the data lives today.
export async function BusinessModule({ w, tab, u, modules }: { w: WorkspaceRow; tab: string; u: SessionUser; modules: WorkspaceModule[] }) {
  const place = { domain: 'business' as const, branch: w.branch, location: null };
  const m = moduleOf(modules, tab);
  if (!m) return null;
  const href = hrefOf(w);
  if (tab === 'documents') return <WorkspaceDocuments u={u} place={place} path={href} title={`מסמכי ${w.name}`} />;
  if (tab === 'branches') return <BranchesPanel w={w} u={u} />;
  if (tab === 'members') return <MembersPanel w={w} u={u} />;
  const money = canSeePlace(u, place, 'money');
  const finance = money ? { href: `/finance?place=${encodeURIComponent(encodePlace(place))}`, label: 'לתנועות של העסק' } : undefined;
  const tasks = { href: `${href}?tab=tasks`, label: 'למשימות של העסק' };
  const notes: Record<string, { note?: string; action?: { href: string; label: string } }> = {
    finance: { note: 'הכנסות, הוצאות ורווח של העסק יוצגו כאן. בינתיים התנועות נמצאות במרכז הכספים, מסוננות לעסק הזה.', action: finance ?? tasks },
    reports: { note: 'דוחות חודשיים והשוואות לתקופה קודמת יוצגו כאן, אחרי שיירשמו תנועות לעסק.', action: finance ?? tasks },
    clients: { note: 'רשימת הלקוחות של העסק תוצג כאן. בינתיים אפשר לנהל מעקב לקוחות כמשימות.', action: tasks },
    collections: { note: 'יתרות פתוחות וגבייה של העסק יוצגו כאן.', action: finance ?? tasks },
  };
  return <ModulePlaceholder wsName={w.name} module={m} note={notes[tab]?.note} action={notes[tab]?.action ?? tasks} />;
}

// A business's branches: each opens its own page. Owners/admins add, rename, set status and archive.
export async function BranchesPanel({ w, u }: { w: WorkspaceRow; u: SessionUser }) {
  const manage = canManageWorkspace(u, w);
  const branches = (await branchesOf(w)).filter(b => b.active);
  const href = hrefOf(w);
  return (
    <Card>
      <CardHeader>
        <CardTitle>סניפים</CardTitle>
        {manage && branches.length > 0 && <AddBranchDialog ws={w.id} />}
      </CardHeader>
      <CardContent>
        {branches.length === 0 ? (
          <Empty compact icon={<MapPin aria-hidden />} title="אין סניפים עדיין">
            <div className="flex flex-col items-center gap-3">
              <span>לעסק עם יותר ממקום אחד: כל סניף מקבל דף משלו עם משימות, יעדים ומסמכים.</span>
              {manage ? <AddBranchDialog ws={w.id} primary /> : <span>מי שמנהל את העסק יכול להוסיף סניפים.</span>}
            </div>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--border)]">
            {branches.map(b => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <Link href={`${href}/${b.id}`} className="flex items-center gap-2 text-body font-medium text-ink hover:underline">
                  <MapPin className="size-4 text-muted" aria-hidden /><bdi>{b.name}</bdi><ChevronLeft className="size-4 text-muted" aria-hidden />
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
      </CardContent>
    </Card>
  );
}
