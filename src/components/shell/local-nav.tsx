'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TabBar, tabClass } from './tabs';

// The sub-menu inside an area (Personal: סקירה, משימות …). Same tab bar as page tabs.
export function LocalNav({ items, label }: { items: { href: string; label: string }[]; label: string }) {
  const path = usePathname();
  return (
    <TabBar label={label}>
      {items.map(i => {
        const on = path === i.href;
        return (
          <li key={i.href}>
            <Link href={i.href} aria-current={on ? 'page' : undefined} className={tabClass(on)}><bdi>{i.label}</bdi></Link>
          </li>
        );
      })}
    </TabBar>
  );
}
