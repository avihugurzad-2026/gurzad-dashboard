'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { crumbs } from '@/lib/places';

// "עסקים / Head Spa Israel / מודיעין / משימות" on every page below Home
export function Breadcrumb() {
  const path = usePathname();
  const tab = useSearchParams().get('tab');
  const items = crumbs(path, tab);
  if (items.length === 0) return null;
  return (
    <nav aria-label="מיקום" className="mb-3 text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="text-line-strong">/</span>}
            {c.href ? <Link href={c.href} className="hover:text-ink hover:underline"><bdi>{c.label}</bdi></Link>
              : <span aria-current="page" className="text-ink-2"><bdi>{c.label}</bdi></span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
