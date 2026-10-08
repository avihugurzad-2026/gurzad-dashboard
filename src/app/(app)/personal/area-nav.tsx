import { LocalNav } from '@/components/shell/local-nav';

// The Personal area menu. Each page passes it to <PageHeader tabs> so it sits under the title.
export const PERSONAL_NAV = [
  { href: '/personal', label: 'סקירה' }, { href: '/personal/tasks', label: 'משימות' },
  { href: '/personal/finance', label: 'כספים משותפים' }, { href: '/personal/goals', label: 'יעדים פיננסיים' },
];

export function PersonalNav() {
  return <LocalNav items={PERSONAL_NAV} label="תפריט אישי" />;
}
