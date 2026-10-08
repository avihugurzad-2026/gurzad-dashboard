import { locationsOf } from '@/lib/places';
import { BUSINESSES, HOUSEHOLD, PERSONAL, VENTURES } from '@/lib/workspaces';

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

// The workspaces tree. Business workspaces get their branches from the location registry
// (src/lib/places.ts, filled from the DB `locations` table), so a new branch appears here with
// no code change; a branch that is not open yet carries the tag "בהקמה".
const ENTITY_ICON: Record<string, string> = { adigital: 'agency', 'head-spa-israel': 'spa' };

export function navAreas(): NavItem[] {
  return [
    { href: PERSONAL.href, label: PERSONAL.navLabel, icon: 'personal', private: true },
    { href: HOUSEHOLD.href, label: HOUSEHOLD.navLabel, icon: 'household' },
    { href: VENTURES.href, label: VENTURES.navLabel, icon: 'ventures' },
    { href: '/business', label: 'עסקים', icon: 'business', children: BUSINESSES.map(w => {
      const locs = locationsOf(w.id);
      const item: NavItem = { href: w.href, label: w.navLabel, icon: ENTITY_ICON[w.id] ?? 'agency' };
      if (locs.length) item.children = locs.map(l => ({ href: `${w.href}/${l.id}`, label: l.label, icon: 'branch', ...(l.status === 'setup' ? { tag: 'בהקמה' } : {}) }));
      return item;
    }) },
  ];
}

// Kept for older imports: the tree as built from the seed rows. Use navAreas() for the live tree.
export const NAV_AREAS: NavItem[] = navAreas();

export const NAV_TOOLS: NavItem[] = [
  { href: '/search', label: 'חיפוש', icon: 'search' },
  { href: '/health#alerts', label: 'התראות', icon: 'bell', count: 'alerts' },
  { href: '/settings', label: 'הגדרות', icon: 'settings' },
];

// "עוד" (collapsed): cross-workspace hubs and admin screens. Nothing was removed, only regrouped.
export const NAV_MORE: NavItem[] = [
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
