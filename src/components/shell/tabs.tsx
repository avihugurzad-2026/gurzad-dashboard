import Link from 'next/link';
import { cn } from '@/lib/utils';

// The one tab bar of the product (page tabs and area menus alike): 15px medium, blue underline.
export const tabClass = (on: boolean) => cn(
  '-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-3 pt-2 text-nav font-medium transition-colors',
  on ? 'border-accent text-ink' : 'border-transparent text-muted hover:border-line-strong hover:text-ink');

export function TabBar({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <nav aria-label={label} className={cn('relative -mx-1 overflow-x-auto', className)}>
      <ul className="flex min-w-max gap-1 border-b border-line px-1">{children}</ul>
    </nav>
  );
}

// Page tabs as links (?tab=…), so every tab has its own URL and works without JS
export function Tabs({ base, tabs, active }: {
  base: string; active: string; tabs: { key: string; label: string; count?: number | null }[];
}) {
  return (
    <TabBar label="לשוניות">
      {tabs.map((t, i) => {
        const on = t.key === active;
        return (
          <li key={t.key}>
            <Link href={i === 0 ? base : `${base}?tab=${t.key}`} aria-current={on ? 'page' : undefined} className={tabClass(on)}>
              <bdi>{t.label}</bdi>
              {t.count ? <span className="rounded-full bg-surface-2 px-1.5 text-xs text-ink-2 tabular">{t.count}</span> : null}
            </Link>
          </li>
        );
      })}
    </TabBar>
  );
}

export const pickTab = <T extends string>(v: unknown, keys: readonly T[]): T =>
  (keys as readonly string[]).includes(String(v)) ? (v as T) : keys[0];
