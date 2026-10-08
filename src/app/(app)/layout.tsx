import { canCreateIn, canSeePlace, currentRegistry, requireUser, type SessionUser } from '@/server/auth';
import { cookies } from 'next/headers';
import { openAlerts } from '@/server/data';
import { db } from '@/server/db';
import { todayIL } from '@/lib/period';
import { encodePlace, placeOptions } from '@/lib/places';
import { AppShell } from '@/components/shell/app-shell';
import { NAV_BOTTOM, NAV_MORE, NAV_TOOLS, NAV_TOP, navAreas, type NavItem } from '@/components/shell/nav';
import { canOpenWorkspace, entityRows, HOUSEHOLD_COOKIE } from '@/server/workspaces';
import type { NavWorkspace } from '@/components/shell/nav';
import type { ClientSession } from '@/components/shell/session-context';
import { inboxCount } from '@/server/entries';

// Which nav links a user may open. Pages check again (requirePlace / requireAdmin).
function navHrefs(u: SessionUser, ws: NavWorkspace[]): string[] {
  const out: string[] = [];
  const walk = (items: NavItem[], test: (i: NavItem) => boolean) => {
    for (const i of items) {
      if (!test(i)) continue;
      out.push(i.href);
      if (i.children) walk(i.children, test);
    }
  };
  const money = u.isOwner || u.memberships.some(m => ['admin', 'manager', 'viewer'].includes(m.role));
  walk(NAV_TOP, i => i.href !== '/tasks' || canSeePlace(u, { domain: 'personal' }));
  walk(navAreas(ws), () => true);   // built from the workspaces the user belongs to
  walk(NAV_TOOLS, i => !i.href.startsWith('/health') || u.isAdmin);
  walk(NAV_MORE, i => i.href === '/finance' ? money : ['/goals', '/documents', '/activity'].includes(i.href) || u.isAdmin);
  walk(NAV_BOTTOM, () => true);
  return out;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Branch registry first: nav, place menus and breadcrumbs are built from it
  const u = await requireUser();   // also loads the workspace and branch registry
  const registry = await currentRegistry();
  // `currentUser` and this layout share the same request-local registry. This
  // avoids three identical workspace reads on every navigation without caching
  // memberships beyond the current request.
  const allWorkspaces = registry?.workspaces ?? [];
  const locations = registry?.locations ?? [];
  const mine = allWorkspaces.filter(w => canOpenWorkspace(u, w));
  const picked = (await cookies()).get(HOUSEHOLD_COOKIE)?.value;
  const households = mine.filter(w => w.kind === 'household');
  const hh = households.find(w => w.id === picked) ?? households[0] ?? null;
  // Current household first, so the nav and place menus default to it
  const ordered = [...mine].sort((a, b) => (a.id === hh?.id ? -1 : b.id === hh?.id ? 1 : 0));
  const workspaces: NavWorkspace[] = ordered.map(w => ({ id: w.id, kind: w.kind, name: w.name, branch: w.branch }));
  const today = todayIL();
  const [open, inbox, people] = await Promise.all([
    u.isAdmin ? openAlerts() : Promise.resolve([]),
    inboxCount(),
    db().query(`SELECT DISTINCT us.id, us.name FROM users us
      WHERE us.active AND (us.id = $1 OR EXISTS (
        SELECT 1 FROM workspace_members mine JOIN workspace_members peer ON peer.workspace_id = mine.workspace_id
        WHERE mine.user_id = $1 AND mine.revoked_at IS NULL AND peer.user_id = us.id AND peer.revoked_at IS NULL
      )) ORDER BY (us.id = $1) DESC, us.name`, [u.id]).then(r => r.rows as { id: string; name: string }[]),
  ]);
  const active = open.filter(a => !(a.snoozed_until && a.snoozed_until > today));
  const session: ClientSession = {
    user: { id: u.id, name: u.name, isOwner: u.isOwner, isAdmin: u.isAdmin },
    places: placeOptions().filter(o => canCreateIn(u, o.place, 'task')).map(o => encodePlace(o.place)),
    people,
    hrefs: navHrefs(u, workspaces),
    locations: locations.filter(l => ordered.some(w => w.kind === 'business' && w.branch === l.branch)),
    workspaces,
    entities: entityRows(ordered),
  };
  return <AppShell counts={{ inbox, alerts: active.length }} session={session}>{children}</AppShell>;
}
