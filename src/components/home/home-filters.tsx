'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RANGES, type RangeKey } from '@/lib/period';
import { cn } from '@/lib/utils';

export const HOME_AREAS = [
  { key: 'all', label: 'הכל' }, { key: 'business', label: 'עסקים' },
  { key: 'personal', label: 'אישי' }, { key: 'ventures', label: 'יזמות' },
] as const;
export type HomeArea = (typeof HOME_AREAS)[number]['key'];

// Global filters on Home: which part of life and which period. State lives in the URL.
export function HomeFilters({ area, range, areas }: { area: HomeArea; range: RangeKey; areas: HomeArea[] }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string, dflt: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === dflt) next.delete(key); else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${path}?${qs}` : path, { scroll: false });
  };
  const seg = (on: boolean) => cn('shrink-0 rounded-md px-2.5 py-1 text-sm transition-colors',
    on ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-2 hover:text-ink');

  return (
    <div className="flex flex-wrap items-center gap-2">
      {areas.length > 2 && (
        <div role="radiogroup" aria-label="תחום" className="flex max-w-full overflow-x-auto rounded-lg border border-line-strong bg-surface p-0.5">
          {HOME_AREAS.filter(a => areas.includes(a.key)).map(a => (
            <button key={a.key} type="button" role="radio" aria-checked={area === a.key} onClick={() => set('area', a.key, 'all')} className={seg(area === a.key)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div role="radiogroup" aria-label="תקופה" className="flex max-w-full overflow-x-auto rounded-lg border border-line-strong bg-surface p-0.5">
        {RANGES.filter(r => r.key !== 'ytd').map(r => (
          <button key={r.key} type="button" role="radio" aria-checked={range === r.key} onClick={() => set('range', r.key, 'month')} className={seg(range === r.key)}>
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
