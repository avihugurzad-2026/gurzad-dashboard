export type NavItem = { href: string; label: string; icon: string; soon?: boolean };

// The seven areas of spec §4, plus the existing review / goals / data-health screens
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'ראשי', items: [
    { href: '/', label: 'סקירה כללית', icon: 'dashboard' },
    { href: '/tasks', label: 'משימות', icon: 'tasks' },
    { href: '/calendar', label: 'יומן', icon: 'calendar', soon: true },
  ] },
  { group: 'כספים', items: [
    { href: '/finance', label: 'הכנסות וגבייה', icon: 'finance' },
    { href: '/documents', label: 'מסמכים', icon: 'documents', soon: true },
    { href: '/reports', label: 'דוחות', icon: 'reports', soon: true },
  ] },
  { group: 'ניהול', items: [
    { href: '/review', label: 'סקירה שבועית', icon: 'review' },
    { href: '/scorecard', label: 'יעדים', icon: 'goals' },
    { href: '/health', label: 'שלמות נתונים', icon: 'health' },
    { href: '/settings', label: 'הגדרות', icon: 'settings', soon: true },
  ] },
];
