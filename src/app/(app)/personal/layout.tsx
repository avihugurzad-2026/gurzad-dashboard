import { LocalNav } from '@/components/shell/local-nav';

const ITEMS = [
  { href: '/personal', label: 'סקירה' }, { href: '/personal/tasks', label: 'משימות' },
  { href: '/personal/finance', label: 'כספים משותפים' }, { href: '/personal/goals', label: 'יעדים פיננסיים' },
];

export default function PersonalLayout({ children }: { children: React.ReactNode }) {
  return <><LocalNav items={ITEMS} label="תפריט אישי" />{children}</>;
}
