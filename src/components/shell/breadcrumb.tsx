'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { crumbs } from '@/lib/places';

// "עסקים › Head Spa Israel › מודיעין" above every page title below Home. The current page is text.
export function Breadcrumb({ extra }: { extra?: string }) {
  const path = usePathname();
  const tab = useSearchParams().get('tab');
  const items = crumbs(path, tab);
  if (extra) items.push({ label: extra, href: null });
  if (items.length === 0) return null;
  return (
    <nav aria-label="מיקום" className="text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronLeft className="size-3.5 text-[color:var(--axis)]" aria-hidden />}
            {c.href && i < items.length - 1 ? <Link href={c.href} className="rounded hover:text-ink"><bdi>{c.label}</bdi></Link>
              : <span aria-current="page" className="text-ink-2"><bdi>{c.label}</bdi></span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
