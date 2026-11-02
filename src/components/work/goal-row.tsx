'use client';
import { report } from '@/lib/report';
import { submitWith } from '@/lib/submit';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { Check, Pencil, RotateCcw, X } from 'lucide-react';
import { setGoalStatus, updateGoal, updateGoalCurrent, type ActionResult } from '@/app/actions';
import { DateField } from '@/components/ui/date-field';
import money from '@domain/money';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { compactInputClass, inputClass, labelClass, numberInputClass, selectClass } from '@/components/work/fields';
import { ils, num, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Goal } from '@/server/entries';
import { GOAL_TYPES, goalTypeLabel } from '@/lib/goals';

const fmt = (unit: Goal['unit'], v: number | null) =>
  v === null ? null : unit === 'ils' ? ils(v) : unit === 'pct' ? `${num(v)}%` : num(v);

export function GoalRow({ goal, path, context }: { goal: Goal; path: string; context?: string }) {
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(goal.current === null ? '' : String(goal.current));
  const [err, setErr] = useState<string | null>(null);
  const pct = goal.target && goal.current !== null ? Math.max(0, Math.min(100, (goal.current / goal.target) * 100)) : null;
  const done = goal.status === 'done';
  const dropped = goal.status === 'dropped';
  const [editing, setEditing] = useState(false);

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
          {done && <Badge tone="good">הושג</Badge>}
          {dropped && <Badge>הוסר</Badge>}
          {done || dropped ? (
            <button type="button" disabled={pending} onClick={() => start(async () => { report(await setGoalStatus(goal.id, 'active', path)); })}
              className={buttonClass('ghost', 'sm')} aria-label="החזר לפעיל">
              <RotateCcw aria-hidden />חזרה לפעיל
            </button>
          ) : (
            <button type="button" disabled={pending} onClick={() => start(async () => { report(await setGoalStatus(goal.id, 'done', path)); })}
              className={buttonClass('ghost', 'sm')} aria-label="סמן כהושג">
              <Check aria-hidden />הושג
            </button>
          )}
          <button type="button" disabled={pending} aria-label="ערוך יעד" aria-expanded={editing} onClick={() => setEditing(e => !e)}
            className={buttonClass('ghost', 'icon', 'size-8 text-muted hover:text-ink')}><Pencil aria-hidden /></button>
          {!dropped && (
            <button type="button" disabled={pending} aria-label="הסר יעד"
              onClick={() => { if (confirm('להסיר את היעד? אפשר להחזיר אותו מ"יעדים שהוסרו".')) start(async () => { report(await setGoalStatus(goal.id, 'dropped', path)); }); }}
              className={buttonClass('ghost', 'icon', 'size-8 text-muted hover:text-critical-ink')}><X aria-hidden /></button>
          )}
        </div>
      </div>
      {editing && <GoalEdit goal={goal} path={path} onDone={() => setEditing(false)} />}
      {goal.target !== null && (
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 rounded-full bg-[color:var(--grid)]" aria-hidden>
            {pct !== null && <div className="h-2 rounded-full bg-[color:var(--series-1)]" style={{ width: `${Math.max(pct, 2)}%` }} />}
          </div>
          {edit ? (
            <form className="flex items-center gap-1.5" onSubmit={e => {
              e.preventDefault();
              const v = money.parseNumber(val);
              if (v !== null && !Number.isFinite(v)) { setErr('מספר לא תקין, למשל 1250.5'); return; }
              start(async () => {
                const r = await updateGoalCurrent(goal.id, v, path);
                if (r && !r.ok) { setErr(r.error ?? 'השמירה נכשלה'); return; }
                setErr(null); setEdit(false);
              });
            }}>
              <label className="sr-only" htmlFor={`cur-${goal.id}`}>מצב היום</label>
              <input id={`cur-${goal.id}`} autoFocus inputMode="decimal" value={val} onChange={e => setVal(e.target.value)}
                dir="ltr" aria-invalid={err ? true : undefined} aria-describedby={err ? `cur-err-${goal.id}` : undefined}
                className={cn(compactInputClass, 'w-28 tabular')} />
              <Button type="submit" variant="primary" size="sm" disabled={pending}>שמור</Button>
              {err && <span id={`cur-err-${goal.id}`} role="alert" className="text-xs text-critical-ink">{err}</span>}
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

// Edit a goal's details in place (progress is updated from the bar)
function GoalEdit({ goal, path, onDone }: { goal: Goal; path: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updateGoal, null);
  useEffect(() => { if (state?.ok) onDone(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form onSubmit={submitWith(action)} className="grid grid-cols-2 gap-x-3 gap-y-4 rounded-lg border border-line bg-surface-2/40 p-3 sm:grid-cols-4">
      <input type="hidden" name="id" value={goal.id} />
      <input type="hidden" name="path" value={path} />
      <label className={cn(labelClass, 'col-span-2 flex flex-col gap-1.5 sm:col-span-4')}>יעד
        <input name="title" required maxLength={300} defaultValue={goal.title} className={inputClass} />
      </label>
      <label className={cn(labelClass, 'flex flex-col gap-1.5')}>יחידה
        <select name="unit" defaultValue={goal.unit} className={selectClass}>
          <option value="ils">₪</option><option value="count">מספר</option><option value="pct">%</option>
        </select>
      </label>
      <label className={cn(labelClass, 'flex flex-col gap-1.5')}>יעד מספרי
        <input name="target" inputMode="decimal" dir="ltr" defaultValue={goal.target ?? ''} className={numberInputClass} />
      </label>
      <label className={cn(labelClass, 'flex flex-col gap-1.5')}>עד תאריך
        <DateField name="due" defaultValue={goal.due ?? undefined} aria-label="עד תאריך" />
      </label>
      <label className={cn(labelClass, 'flex flex-col gap-1.5')}>סוג
        <select name="goal_type" defaultValue={goal.goal_type ?? undefined} className={selectClass}>
          {GOAL_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      <label className={cn(labelClass, 'col-span-2 flex flex-col gap-1.5 sm:col-span-4')}>הערות
        <input name="notes" maxLength={1000} defaultValue={goal.notes ?? ''} className={inputClass} />
      </label>
      <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-4">
        {state && !state.ok && <p role="alert" className="me-auto text-sm text-critical-ink">{state.error}</p>}
        <Button variant="ghost" size="sm" onClick={onDone}>ביטול</Button>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>שמור</Button>
      </div>
    </form>
  );
}
