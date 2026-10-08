import { LocalNav } from '@/components/shell/local-nav';
import { ENTITIES } from '@/lib/places';

// The Ventures area menu. Each page passes it to <PageHeader tabs> so it sits under the title.
export const VENTURES_NAV = [
  { href: '/ventures', label: 'סקירה' },
  ...ENTITIES.filter(e => e.domain === 'ventures').map(e => ({ href: e.href, label: e.label })),
];

export function VenturesNav() {
  return <LocalNav items={VENTURES_NAV} label="תפריט יזמות" />;
}
