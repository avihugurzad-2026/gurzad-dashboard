import { LocalNav } from '@/components/shell/local-nav';
import { ENTITIES } from '@/lib/places';

const ITEMS = [{ href: '/ventures', label: 'סקירה' }, ...ENTITIES.filter(e => e.domain === 'ventures').map(e => ({ href: e.href, label: e.label }))];

export default function VenturesLayout({ children }: { children: React.ReactNode }) {
  return <><LocalNav items={ITEMS} label="תפריט יזמות" />{children}</>;
}
