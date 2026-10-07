import Link from 'next/link';
import { cn } from '@/lib/utils';

// Page tabs as links (?tab=…), so every tab has its own URL and works without JS
export function Tabs({ base, tabs, active }: {
  base: string; active: string; tabs: { key: string; label: string; count?: number | null }[];
}) {
  return (
    <nav aria-label="לשוניות" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-line px-1">
        {tabs.map((t, i) => {
          const on = t.key === active;
          return (
            <li key={t.key}>
              <Link href={i === 0 ? base : `${base}?tab=${t.key}`} aria-current={on ? 'page' : undefined}
                className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm',
                  on ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink')}>
                {t.label}
                {t.count ? <span className="rounded-full bg-surface-2 px-1.5 text-xs text-muted tabular">{t.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export const pickTab = <T extends string>(v: unknown, keys: readonly T[]): T =>
  (keys as readonly string[]).includes(String(v)) ? (v as T) : keys[0];
