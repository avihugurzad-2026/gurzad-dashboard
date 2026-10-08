import Link from 'next/link';
import { Hammer, Lock, Users } from 'lucide-react';
import { KIND_LABEL, type Workspace, type WorkspaceModule } from '@/lib/workspaces';
import { NO_DATA } from '@/lib/format';
import { LocalNav } from '@/components/shell/local-nav';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { buttonClass } from '@/components/ui/button';

// "פרטי" for a private workspace, "משותף · 2 חברים" for a shared one. Sits next to the page title.
export function WorkspaceBadge({ ws }: { ws: Pick<Workspace, 'kind' | 'name' | 'memberCount'> }) {
  if (ws.kind === 'personal') return <Badge tone="neutral"><Lock aria-hidden />פרטי · רק אתה</Badge>;
  const n = ws.memberCount ?? 0;
  if (n > 1) return <Badge tone="accent"><Users aria-hidden />משותף · {n} חברים</Badge>;
  return KIND_LABEL[ws.kind] !== ws.name ? <Badge tone="accent">{KIND_LABEL[ws.kind]}</Badge> : null;
}

// The module menu of a workspace whose modules are their own pages (personal, household, ventures)
export function WorkspaceNav({ modules, label }: { modules: WorkspaceModule[]; label: string }) {
  return <LocalNav items={modules.map(m => ({ href: m.href, label: m.label }))} label={`תפריט ${label}`} />;
}

// Business modules are ?tab= tabs on the business page
export function workspaceTabs(modules: WorkspaceModule[], counts: Record<string, number | null | undefined> = {}) {
  return modules.map(m => ({ key: m.key, label: m.label, count: counts[m.key] ?? null }));
}

// A module that is part of the structure but has no data source yet: says what will live here.
// Each planned section shows "אין נתונים עדיין", never a number.
export function ModulePlaceholder({ wsName, module, action, note }: {
  wsName: string; module: WorkspaceModule; action?: { href: string; label: string }; note?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between sm:pt-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-muted"><Hammer className="size-5" aria-hidden /></span>
            <div className="flex flex-col gap-1">
              <p className="text-card font-semibold text-ink"><bdi>{module.label}</bdi> בהכנה</p>
              <p className="text-sm text-muted">
                {note ?? <>המקום של המודול הזה ב<bdi>{wsName}</bdi> כבר מוכן, והוא יקבל נתונים בשלב הבא.</>}
              </p>
            </div>
          </div>
          {action && <Link href={action.href} className={buttonClass('secondary', 'md', 'shrink-0')}>{action.label}</Link>}
        </CardContent>
      </Card>
      {module.sections && module.sections.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {module.sections.map(s => (
            <li key={s}>
              <Card className="flex h-full flex-col gap-2 px-5 py-4">
                <p className="text-body font-medium text-ink"><bdi>{s}</bdi></p>
                <p className="text-sm text-muted">{NO_DATA}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
