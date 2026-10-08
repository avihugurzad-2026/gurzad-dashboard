import { ENTITIES, locationsOf } from '@/lib/places';

export type NavItem = { href: string; label: string; icon: string; tag?: string; count?: 'inbox' | 'alerts'; children?: NavItem[] };

// Sidebar: general day screens, the hubs, the areas tree, then tools and the bottom row.
export const NAV_TOP: NavItem[] = [
  { href: '/', label: 'בית', icon: 'home' },
  { href: '/today', label: 'היום', icon: 'today' },
  { href: '/calendar', label: 'לוח שנה', icon: 'calendar' },
  { href: '/inbox', label: 'Inbox', icon: 'inbox', count: 'inbox' },
];

export const NAV_HUBS: NavItem[] = [
  { href: '/tasks', label: 'משימות', icon: 'tasks' },
  { href: '/finance', label: 'כספים', icon: 'money' },
  { href: '/goals', label: 'יעדים', icon: 'goal' },
  { href: '/documents', label: 'מסמכים', icon: 'document' },
];

// The areas tree. Business entities get their branches from the location registry
// (src/lib/places.ts, filled from the DB `locations` table), so a new branch appears here with
// no code change; a branch that is not open yet carries the tag "בהקמה".
const ENTITY_ICON: Record<string, string> = { adigital: 'agency', 'head-spa-israel': 'spa' };

export function navAreas(): NavItem[] {
  return [
    { href: '/personal', label: 'אישי', icon: 'personal' },
    { href: '/ventures', label: 'יזמות', icon: 'ventures' },
    { href: '/business', label: 'עסקים', icon: 'business', children: ENTITIES.filter(e => e.domain === 'business').map(e => {
      const locs = locationsOf(e.id);
      const item: NavItem = { href: e.href, label: e.label, icon: ENTITY_ICON[e.id] ?? 'agency' };
      if (locs.length) item.children = locs.map(l => ({ href: `${e.href}/${l.id}`, label: l.label, icon: 'branch', ...(l.status === 'setup' ? { tag: 'בהקמה' } : {}) }));
      return item;
    }) },
  ];
}

// Kept for older imports: the tree as built from the seed rows. Use navAreas() for the live tree.
export const NAV_AREAS: NavItem[] = navAreas();

// Tools (collapsible). The activity log is per user; the others are admin screens.
export const NAV_TOOLS: NavItem[] = [
  { href: '/insights', label: 'סקירה עסקית', icon: 'chart' },
  { href: '/review', label: 'סקירה שבועית', icon: 'review' },
  { href: '/scorecard', label: 'מדדים שבועיים', icon: 'scorecard' },
  { href: '/activity', label: 'יומן פעילות', icon: 'history' },
  { href: '/health', label: 'מצב מערכת', icon: 'health' },
];

export const NAV_BOTTOM: NavItem[] = [
  { href: '/search', label: 'חיפוש', icon: 'search' },
  { href: '/health#alerts', label: 'התראות', icon: 'bell', count: 'alerts' },
  { href: '/settings', label: 'הגדרות', icon: 'settings' },
  { href: '/settings#profile', label: 'פרופיל', icon: 'profile' },
];
