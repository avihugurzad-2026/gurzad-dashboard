import { canCreateIn, canSeePlace, requireUser, type SessionUser } from '@/server/auth';
import { openAlerts } from '@/server/data';
import { db } from '@/server/db';
import { todayIL } from '@/lib/period';
import { encodePlace, placeOptions } from '@/lib/places';
import { AppShell } from '@/components/shell/app-shell';
import { NAV_BOTTOM, NAV_MORE, NAV_TOOLS, NAV_TOP, navAreas, type NavItem } from '@/components/shell/nav';
import { workspaceAccessPlace } from '@/lib/workspaces';
import type { ClientSession } from '@/components/shell/session-context';
import { inboxCount } from '@/server/entries';
import { loadLocations } from '@/server/locations';

// Which nav links a user may open. Pages check again (requirePlace / requireAdmin).
function navHrefs(u: SessionUser): string[] {
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
  walk(navAreas(), i => canSeePlace(u, workspaceAccessPlace(i.href)));
  walk(NAV_TOOLS, i => !i.href.startsWith('/health') || u.isAdmin);
  walk(NAV_MORE, i => i.href === '/finance' ? money : ['/goals', '/documents', '/activity'].includes(i.href) || u.isAdmin);
  walk(NAV_BOTTOM, () => true);
  return out;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Branch registry first: nav, place menus and breadcrumbs are built from it
  const [u, locations] = await Promise.all([requireUser(), loadLocations()]);
  const today = todayIL();
  const [open, inbox, people] = await Promise.all([
    u.isAdmin ? openAlerts() : Promise.resolve([]),
    inboxCount(),
    db().query(`SELECT id, name FROM users WHERE active ORDER BY (id = $1) DESC, name`, [u.id]).then(r => r.rows as { id: string; name: string }[]),
  ]);
  const active = open.filter(a => !(a.snoozed_until && a.snoozed_until > today));
  const session: ClientSession = {
    user: { id: u.id, name: u.name, isOwner: u.isOwner, isAdmin: u.isAdmin },
    places: placeOptions().filter(o => canCreateIn(u, o.place, 'task')).map(o => encodePlace(o.place)),
    people,
    hrefs: navHrefs(u),
    locations,
  };
  return <AppShell counts={{ inbox, alerts: active.length }} session={session}>{children}</AppShell>;
}
