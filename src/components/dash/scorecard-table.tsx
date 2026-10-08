'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import { ils } from '@/lib/format';
import money from '@domain/money';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { compactInputClass } from '@/components/work/fields';
import { cn } from '@/lib/utils';

const MONEY = new Set(['cash_operating', 'mrr', 'open_debts', 'overdue_debt_30']);

export type Cell = { period: string; value: number | null; status: 'on' | 'off' | null };
export type Measure = {
  key: string; name_he: string; owner: string | null; weekly_goal: number | null;
  direction: 'higher_better' | 'lower_better'; locked_until: string | null;
  cells: Cell[]; suggest_issue: boolean;
};

function fmt(key: string, v: number | null) {
  if (v === null) return null;
  if (MONEY.has(key)) return ils(v);
  if (key.endsWith('_pct')) return `${v}%`;
  return String(v);
}

// 13 weeks per measure. A week with no snapshot shows "–", never 0.
export function ScorecardTable({ weeks, measures, editable = false }: {
  weeks: string[]; measures: Measure[]; editable?: boolean;
}) {
  if (!measures.length) return <p className="text-sm text-muted">אין מדדים מוגדרים</p>;
  // RTL reads right to left, so the newest week sits first
  const order = [...weeks].reverse();
  return (
    <div className="relative overflow-x-auto">
      {/* 13 week columns do not fit on a phone: scroll instead of squeezing the names */}
      <table className="data-table w-max min-w-full">
        <thead>
          <tr>
            <th scope="col" className="min-w-[220px]">מדד</th>
            <th scope="col" className="min-w-[170px]">יעד שבועי</th>
            {order.map(w => <th key={w} scope="col" className="min-w-[84px] text-center tabular">{w.slice(5)}</th>)}
          </tr>
        </thead>
        <tbody>
          {measures.map(m => (
            <tr key={m.key} className="align-top">
              <th scope="row" className="min-w-[220px] whitespace-normal pe-4 font-medium text-ink">
                <bdi>{m.name_he}</bdi>
                <p className="mt-0.5 text-xs font-normal text-muted">
                  {m.owner && <><bdi>{m.owner}</bdi> · </>}
                  {m.direction === 'lower_better' ? 'נמוך = טוב' : 'גבוה = טוב'}
                </p>
                {m.suggest_issue && (
                  <p className="mt-1 flex items-center gap-1 text-xs font-normal text-warning-ink">
                    <TriangleAlert className="size-4 shrink-0" aria-hidden />
                    חורג שבועיים ברצף
                  </p>
                )}
              </th>
              <td className="min-w-[170px] pe-4">
                {m.weekly_goal === null
                  ? <span className="text-muted">טרם נקבע</span>
                  : <bdi className={cn('font-medium tabular', MONEY.has(m.key) && 'amount')}>{fmt(m.key, m.weekly_goal)}</bdi>}
                {m.locked_until && <p className="mt-0.5 text-xs text-muted">נעול עד {m.locked_until}</p>}
                {editable && <GoalForm measure={m} />}
              </td>
              {[...m.cells].reverse().map(c => {
                const text = fmt(m.key, c.value);
                return (
                  <td key={c.period} className={cn('text-center whitespace-nowrap tabular',
                    c.status === 'off' && 'font-medium text-critical-ink')}>
                    {text === null ? <span className="text-muted" title="אין נתונים">–</span> : (
                      <span className="inline-flex items-center gap-0.5">
                        {c.status === 'off' && <TriangleAlert className="size-4 shrink-0" aria-label="חורג מהיעד" />}
                        <bdi className={cn(MONEY.has(m.key) && 'amount')}>{text}</bdi>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GoalForm({ measure }: { measure: Measure }) {
  const router = useRouter();
  const [goal, setGoal] = useState('');
  const [quarterly, setQuarterly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = measure.locked_until !== null && measure.weekly_goal !== null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = money.parseNumber(goal);
    if (n === null || !Number.isFinite(n)) { setError('יעד: מספר, למשל 12.5'); return; }
    setBusy(true); setError(null);
    const res = await fetch(`/api/v1/scorecard/${encodeURIComponent(measure.key)}/goal`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekly_goal: n, quarterly_planning: quarterly }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'השמירה נכשלה'); return; }
    setGoal(''); setQuarterly(false);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col items-start gap-1.5">
      <div className="flex items-center gap-1.5">
        <label className="sr-only" htmlFor={`goal-${measure.key}`}>יעד שבועי</label>
        <input id={`goal-${measure.key}`} inputMode="decimal" dir="ltr" autoComplete="off" required value={goal} onChange={e => setGoal(e.target.value)}
          placeholder={measure.weekly_goal === null ? 'קבע יעד' : 'יעד חדש'}
          className={cn(compactInputClass, 'w-24')} />
        <Button size="sm" type="submit" disabled={busy || goal === ''}>שמור</Button>
      </div>
      {locked && (
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={quarterly} onChange={e => setQuarterly(e.target.checked)} />
          תכנון רבעוני
        </label>
      )}
      {error && <Badge tone="critical" role="alert">{error}</Badge>}
    </form>
  );
}
