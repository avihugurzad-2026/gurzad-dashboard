'use client';
import { useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';
import { setGoalStatus, updateGoalCurrent } from '@/app/actions';
import { Badge } from '@/components/ui/badge';
import { ils, num, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Goal } from '@/server/entries';

const fmt = (unit: Goal['unit'], v: number | null) =>
  v === null ? null : unit === 'ils' ? ils(v) : unit === 'pct' ? `${num(v)}%` : num(v);

export function GoalRow({ goal, path }: { goal: Goal; path: string }) {
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(goal.current === null ? '' : String(goal.current));
  const pct = goal.target && goal.current !== null ? Math.max(0, Math.min(100, (goal.current / goal.target) * 100)) : null;
  const done = goal.status === 'done';

  return (
    <li className={cn('flex flex-col gap-2 py-3', pending && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn('text-sm font-medium text-ink', done && 'text-muted line-through')}><bdi>{goal.title}</bdi></p>
          <p className="mt-0.5 text-xs text-muted">
            {goal.target !== null ? <>יעד: <bdi className={cn('tabular', goal.unit === 'ils' && 'amount')}>{fmt(goal.unit, goal.target)}</bdi></> : 'בלי יעד מספרי'}
            {goal.due && <> · עד {shortDate(goal.due)}</>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {done ? <Badge tone="good">הושג</Badge> : (
            <button type="button" disabled={pending} onClick={() => start(async () => { await setGoalStatus(goal.id, 'done', path); })}
              className="rounded-md px-2 py-1 text-xs text-ink-2 hover:bg-surface-2" aria-label="סמן כהושג">
              <Check className="inline size-3.5" aria-hidden /> הושג
            </button>
          )}
          <button type="button" disabled={pending} aria-label="הסר יעד"
            onClick={() => { if (confirm('להסיר את היעד?')) start(async () => { await setGoalStatus(goal.id, 'dropped', path); }); }}
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-critical-ink"><X className="size-4" aria-hidden /></button>
        </div>
      </div>
      {goal.target !== null && (
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 rounded-full bg-[color:var(--grid)]" aria-hidden>
            {pct !== null && <div className="h-2 rounded-full bg-[color:var(--series-1)]" style={{ width: `${Math.max(pct, 2)}%` }} />}
          </div>
          {edit ? (
            <form className="flex items-center gap-1" onSubmit={e => {
              e.preventDefault();
              const v = val.trim() === '' ? null : Number(val.replace(/,/g, ''));
              start(async () => { await updateGoalCurrent(goal.id, v, path); setEdit(false); });
            }}>
              <label className="sr-only" htmlFor={`cur-${goal.id}`}>מצב היום</label>
              <input id={`cur-${goal.id}`} autoFocus inputMode="decimal" value={val} onChange={e => setVal(e.target.value)}
                className="h-7 w-24 rounded-md border border-line-strong bg-surface px-2 text-xs" />
              <button type="submit" className="rounded-md bg-accent px-2 py-1 text-xs text-white">שמור</button>
            </form>
          ) : (
            <button type="button" onClick={() => setEdit(true)} className="text-xs text-ink-2 hover:underline">
              {goal.current === null ? 'עדכן מצב' : <>{pct !== null && `${Math.round(pct)}% · `}<bdi className={cn('tabular', goal.unit === 'ils' && 'amount')}>{fmt(goal.unit, goal.current)}</bdi></>}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
