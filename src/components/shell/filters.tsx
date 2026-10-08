'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RANGES, type RangeKey } from '@/lib/period';
import { cn } from '@/lib/utils';
import { selectClass } from '@/components/work/fields';

// Workspace and time-range pickers; state lives in the URL so views are shareable and reload-safe
export function Filters({ workspaces, workspace, range }: {
  workspaces: { branch: string; name_he: string | null; entity_count: number }[];
  workspace: string | null; range?: RangeKey;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    const qs = next.toString();
    router.push(qs ? `${path}?${qs}` : path);
  };

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="ws">עסק</label>
      <select id="ws" value={workspace ?? 'all'} onChange={e => set('w', e.target.value === 'all' ? null : e.target.value)}
        className={cn(selectClass, 'h-9 w-auto')}>
        <option value="all">כל העסקים</option>
        {workspaces.map(w => (
          <option key={w.branch} value={w.branch}>{w.name_he || w.branch}{w.entity_count === 0 ? ' (אין נתונים)' : ''}</option>
        ))}
      </select>
      {range && (
        <div role="radiogroup" aria-label="טווח זמן" className="inline-flex h-9 max-w-full items-center overflow-x-auto rounded-lg border border-line-strong bg-surface p-0.5">
          {RANGES.map(r => (
            <button key={r.key} type="button" role="radio" aria-checked={range === r.key} onClick={() => set('range', r.key)}
              className={cn('flex h-full items-center rounded-md px-3 text-sm transition-colors',
                range === r.key ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-2 hover:text-ink')}>
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
