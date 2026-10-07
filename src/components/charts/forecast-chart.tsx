'use client';
import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ils, shortDate } from '@/lib/format';

export type ForecastWeek = { start: string; in: number; out: number; closing: number | null };

function Readout({ active, payload, label }: { active?: boolean; payload?: { payload?: ForecastWeek }[]; label?: string }) {
  const w = payload?.[0]?.payload;
  if (!active || !w) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-card">
      <p className="mb-1 text-xs text-muted">שבוע של {shortDate(String(label))}</p>
      <p className="font-semibold tabular amount"><bdi>{ils(w.closing)}</bdi> <span className="font-normal text-muted">יתרת סגירה</span></p>
      <p className="text-ink-2 tabular">נכנס <bdi className="amount">{ils(w.in)}</bdi> · יוצא <bdi className="amount">{ils(w.out)}</bdi></p>
    </div>
  );
}

// 13-week operating cash, with the cash floor marked. Starts at zero; no guessed dates.
export function ForecastChart({ weeks, floor }: { weeks: ForecastWeek[]; floor: number | null }) {
  const titleId = useId();
  return (
    <figure className="m-0 h-60 w-full" role="img" aria-labelledby={titleId}>
      <span id={titleId} className="sr-only">תחזית מזומן תפעולי ל-13 שבועות</span>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={weeks} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="fcFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="start" tickFormatter={shortDate} tick={{ fill: 'var(--muted)', fontSize: 12 }}
            stroke="var(--axis)" tickMargin={6} interval="preserveStartEnd" reversed />
          <YAxis orientation="right" tick={{ fill: 'var(--muted)', fontSize: 12 }} stroke="var(--axis)" width={64}
            domain={[0, 'auto']} tickFormatter={v => new Intl.NumberFormat('he-IL', { notation: 'compact' }).format(v)} />
          <Tooltip content={<Readout />} cursor={{ stroke: 'var(--axis)' }} />
          {floor !== null && (
            <ReferenceLine y={floor} stroke="var(--critical)" strokeDasharray="4 4"
              label={{ value: 'רצפת מזומן', position: 'insideTopRight', fill: 'var(--critical-ink)', fontSize: 12 }} />
          )}
          <Area type="monotone" dataKey="closing" stroke="var(--series-1)" strokeWidth={2} fill="url(#fcFill)"
            connectNulls={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
