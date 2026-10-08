'use client';
import { useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';
import { setGoalStatus, updateGoalCurrent } from '@/app/actions';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { compactInputClass } from '@/components/work/fields';
import { ils, num, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Goal } from '@/server/entries';
import { goalTypeLabel } from '@/lib/goals';

const fmt = (unit: Goal['unit'], v: number | null) =>
  v === null ? null : unit === 'ils' ? ils(v) : unit === 'pct' ? `${num(v)}%` : num(v);

export function GoalRow({ goal, path, context }: { goal: Goal; path: string; context?: string }) {
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(goal.current === null ? '' : String(goal.current));
  const pct = goal.target && goal.current !== null ? Math.max(0, Math.min(100, (goal.current / goal.target) * 100)) : null;
  const done = goal.status === 'done';

  return (
    <li className={cn('flex flex-col gap-3 py-4', pending && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className={cn('text-body font-medium text-ink', done && 'font-normal text-muted line-through')}><bdi>{goal.title}</bdi></p>
          <p className="text-xs text-muted">
            {goal.target !== null ? <>יעד: <bdi className={cn('tabular', goal.unit === 'ils' && 'amount')}>{fmt(goal.unit, goal.target)}</bdi></> : 'בלי יעד מספרי'}
            {goal.due && <> · עד {shortDate(goal.due)}</>}
          </p>
          <p className="flex flex-wrap items-center gap-1.5">
            {goalTypeLabel(goal.goal_type) && <Badge>{goalTypeLabel(goal.goal_type)}</Badge>}
            {context && <Badge tone="accent"><bdi dir="rtl">{context}</bdi></Badge>}
            {goal.scope === 'shared' && <Badge>משותף</Badge>}
          </p>
          {goal.notes && <p className="text-sm text-ink-2"><bdi>{goal.notes}</bdi></p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {done ? <Badge tone="good">הושג</Badge> : (
            <button type="button" disabled={pending} onClick={() => start(async () => { await setGoalStatus(goal.id, 'done', path); })}
              className={buttonClass('ghost', 'sm')} aria-label="סמן כהושג">
              <Check aria-hidden />הושג
            </button>
          )}
          <button type="button" disabled={pending} aria-label="הסר יעד"
            onClick={() => { if (confirm('להסיר את היעד?')) start(async () => { await setGoalStatus(goal.id, 'dropped', path); }); }}
            className={buttonClass('ghost', 'icon', 'size-8 text-muted hover:text-critical-ink')}><X aria-hidden /></button>
        </div>
      </div>
      {goal.target !== null && (
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 rounded-full bg-[color:var(--grid)]" aria-hidden>
            {pct !== null && <div className="h-2 rounded-full bg-[color:var(--series-1)]" style={{ width: `${Math.max(pct, 2)}%` }} />}
          </div>
          {edit ? (
            <form className="flex items-center gap-1.5" onSubmit={e => {
              e.preventDefault();
              const v = val.trim() === '' ? null : Number(val.replace(/,/g, ''));
              start(async () => { await updateGoalCurrent(goal.id, v, path); setEdit(false); });
            }}>
              <label className="sr-only" htmlFor={`cur-${goal.id}`}>מצב היום</label>
              <input id={`cur-${goal.id}`} autoFocus inputMode="decimal" value={val} onChange={e => setVal(e.target.value)}
                className={cn(compactInputClass, 'w-28 tabular')} />
              <Button type="submit" variant="primary" size="sm">שמור</Button>
            </form>
          ) : (
            <button type="button" onClick={() => setEdit(true)} className="shrink-0 rounded-md text-sm text-ink-2 hover:text-ink hover:underline">
              {goal.current === null ? 'עדכן מצב' : <>{pct !== null && `${Math.round(pct)}% · `}<bdi className={cn('tabular', goal.unit === 'ils' && 'amount')}>{fmt(goal.unit, goal.current)}</bdi></>}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
