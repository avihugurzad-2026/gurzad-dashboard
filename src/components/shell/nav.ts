export type NavItem = { href: string; label: string; icon: string; soon?: boolean; children?: NavItem[] };

// Three areas (business / personal / ventures), each with its own pages, then the system screens.
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'ראשי', items: [
    { href: '/', label: 'סקירה כללית', icon: 'dashboard' },
  ] },
  { group: 'עסקים', items: [
    { href: '/business/adigital', label: 'a-digital', icon: 'agency' },
    { href: '/business/head-spa-israel', label: 'הד ספא ישראל', icon: 'spa', children: [
      { href: '/business/head-spa-israel/modiin', label: 'סניף מודיעין', icon: 'branch' },
      { href: '/business/head-spa-israel/jerusalem', label: 'סניף ירושלים', icon: 'branch' },
    ] },
  ] },
  { group: 'אישי', items: [
    { href: '/personal/tasks', label: 'משימות', icon: 'tasks' },
    { href: '/personal/finance', label: 'כספים משותפים', icon: 'finance' },
    { href: '/personal/goals', label: 'יעדים פיננסיים', icon: 'goals' },
  ] },
  { group: 'יזמות', items: [
    { href: '/ventures/real-estate', label: 'נכסים', icon: 'property' },
    { href: '/ventures/investments', label: 'השקעות', icon: 'invest' },
    { href: '/ventures/legal-and-tasks', label: 'משפטי', icon: 'legal' },
    { href: '/ventures/finance', label: 'פיננסים', icon: 'bank' },
  ] },
  { group: 'ניהול', items: [
    { href: '/review', label: 'סקירה שבועית', icon: 'review' },
    { href: '/scorecard', label: 'מדדים שבועיים', icon: 'chart' },
    { href: '/health', label: 'שלמות נתונים', icon: 'health' },
    { href: '/calendar', label: 'יומן', icon: 'calendar', soon: true },
    { href: '/documents', label: 'מסמכים', icon: 'documents', soon: true },
    { href: '/settings', label: 'הגדרות', icon: 'settings', soon: true },
  ] },
];
