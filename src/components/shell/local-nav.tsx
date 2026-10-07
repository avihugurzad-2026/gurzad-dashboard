'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

// The sub-menu inside an area (Personal: סקירה, משימות …), shown above the area's pages
export function LocalNav({ items, label }: { items: { href: string; label: string }[]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="-mx-1 mb-5 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-line px-1">
        {items.map(i => {
          const on = path === i.href;
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={on ? 'page' : undefined}
                className={cn('-mb-px block border-b-2 px-3 py-2 text-sm', on ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink')}>
                <bdi>{i.label}</bdi>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
