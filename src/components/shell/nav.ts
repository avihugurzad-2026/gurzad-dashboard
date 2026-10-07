export type NavItem = { href: string; label: string; icon: string; tag?: string; count?: 'inbox' | 'alerts'; children?: NavItem[] };

// Sidebar (stage 1 spec): the day screens, then the three areas, then the bottom row.
export const NAV_TOP: NavItem[] = [
  { href: '/', label: 'בית', icon: 'home' },
  { href: '/today', label: 'היום', icon: 'today' },
  { href: '/calendar', label: 'לוח שנה', icon: 'calendar' },
  { href: '/inbox', label: 'Inbox', icon: 'inbox', count: 'inbox' },
  { href: '/finance', label: 'כספים', icon: 'money' },
  { href: '/goals', label: 'יעדים', icon: 'goal' },
];

export const NAV_AREAS: NavItem[] = [
  { href: '/personal', label: 'אישי', icon: 'personal' },
  { href: '/ventures', label: 'יזמות', icon: 'ventures' },
  { href: '/business', label: 'עסקים', icon: 'business', children: [
    { href: '/business/adigital', label: 'a-digital', icon: 'agency' },
    { href: '/business/head-spa-israel', label: 'Head Spa Israel', icon: 'spa', children: [
      { href: '/business/head-spa-israel/modiin', label: 'מודיעין', icon: 'branch' },
      { href: '/business/head-spa-israel/jerusalem', label: 'ירושלים', icon: 'branch', tag: 'בהקמה' },
    ] },
  ] },
];

// Screens built before stage 1, kept reachable
export const NAV_TOOLS: NavItem[] = [
  { href: '/insights', label: 'סקירה עסקית', icon: 'chart' },
  { href: '/review', label: 'סקירה שבועית', icon: 'review' },
  { href: '/scorecard', label: 'מדדים שבועיים', icon: 'scorecard' },
  { href: '/health', label: 'שלמות נתונים', icon: 'health' },
];

export const NAV_BOTTOM: NavItem[] = [
  { href: '/search', label: 'חיפוש', icon: 'search' },
  { href: '/health#alerts', label: 'התראות', icon: 'bell', count: 'alerts' },
  { href: '/settings', label: 'הגדרות', icon: 'settings' },
  { href: '/settings#profile', label: 'פרופיל', icon: 'profile' },
];
