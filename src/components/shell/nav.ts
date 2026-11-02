import { locationsOf } from '@/lib/places';

export type NavItem = { href: string; label: string; icon: string; tag?: string; count?: 'inbox' | 'alerts'; private?: boolean; children?: NavItem[] };

// Sidebar (USER → WORKSPACES): general screens, "האזורים שלי" (one entry per workspace, from
// src/lib/workspaces.ts), tools, and a collapsed "עוד" group that keeps every older screen one click away.
export const NAV_TOP: NavItem[] = [
  { href: '/', label: 'בית', icon: 'home' },
  { href: '/today', label: 'היום', icon: 'today' },
  { href: '/calendar', label: 'לוח שנה', icon: 'calendar' },
  { href: '/inbox', label: 'Inbox', icon: 'inbox', count: 'inbox' },
  { href: '/tasks', label: 'משימות', icon: 'tasks' },
];

// "האזורים שלי": built from the workspaces this user belongs to (DB rows, sent in the session).
// Businesses get their branches from the location registry, so a new business or branch appears
// here as soon as it is created in the UI; a branch that is not open yet carries the tag "בהקמה".
export type NavWorkspace = { id: string; kind: 'personal' | 'household' | 'business' | 'ventures'; name: string; branch: string | null };

export function navAreas(workspaces: NavWorkspace[]): NavItem[] {
  const out: NavItem[] = [{ href: '/personal', label: 'אישי', icon: 'personal', private: true }];
  const households = workspaces.filter(w => w.kind === 'household');
  // One entry for the household area; with several households it opens the current one (switcher on the page)
  out.push({ href: '/household', label: households[0]?.name ?? 'הבית שלנו', icon: 'household' });
  if (workspaces.some(w => w.kind === 'ventures')) out.push({ href: '/ventures', label: 'יזמות', icon: 'ventures' });
  const businesses = workspaces.filter(w => w.kind === 'business' && w.branch);
  out.push({ href: '/business', label: 'עסקים', icon: 'business', children: businesses.map(w => {
    const href = `/business/${w.branch}`;
    const locs = locationsOf(w.branch!);
    const item: NavItem = { href, label: w.name, icon: 'agency' };
    if (locs.length) item.children = locs.map(l => ({ href: `${href}/${l.id}`, label: l.label, icon: 'branch', ...(l.status === 'setup' ? { tag: 'בהקמה' } : {}) }));
    return item;
  }) });
  return out;
}

export const NAV_TOOLS: NavItem[] = [
  { href: '/search', label: 'חיפוש', icon: 'search' },
  { href: '/health#alerts', label: 'התראות', icon: 'bell', count: 'alerts' },
  { href: '/settings', label: 'הגדרות', icon: 'settings' },
];

// "עוד" (collapsed): cross-workspace hubs and admin screens. Nothing was removed, only regrouped.
export const NAV_MORE: NavItem[] = [
  { href: '/workspaces', label: 'ניהול אזורים', icon: 'business' },
  { href: '/finance', label: 'כל התנועות', icon: 'money' },
  { href: '/goals', label: 'כל היעדים', icon: 'goal' },
  { href: '/documents', label: 'כל המסמכים', icon: 'document' },
  { href: '/insights', label: 'סקירה עסקית', icon: 'chart' },
  { href: '/review', label: 'סקירה שבועית', icon: 'review' },
  { href: '/scorecard', label: 'מדדים שבועיים', icon: 'scorecard' },
  { href: '/activity', label: 'יומן פעילות', icon: 'history' },
  { href: '/health', label: 'מצב מערכת', icon: 'health' },
];

export const NAV_BOTTOM: NavItem[] = [
  { href: '/settings#profile', label: 'פרופיל', icon: 'profile' },
];
