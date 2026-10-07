'use client';
import { useId } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ils } from '@/lib/format';

export type MonthPoint = { month: string; value: number | null };

const monthFmt = new Intl.DateTimeFormat('he-IL', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const monthLabel = (iso: string) => monthFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

function Readout({ active, payload, label }: { active?: boolean; payload?: { value?: number | null }[]; label?: string }) {
  const v = payload?.[0]?.value;
  if (!active || v === null || v === undefined) return null;
  return (
    <div dir="rtl" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-card">
      <p className="mb-0.5 text-xs text-muted">{monthLabel(String(label))}</p>
      <bdi className="font-semibold tabular amount">{ils(v)}</bdi>
    </div>
  );
}

// One series, one ₪ axis. A month with no data has no bar (never a 0 bar).
export function MonthlyBars({ data, caption }: { data: MonthPoint[]; caption: string }) {
  const titleId = useId();
  return (
    <div className="h-60 w-full" dir="ltr" role="img" aria-labelledby={titleId}>
      <span id={titleId} className="sr-only">{caption}</span>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
          <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: 'var(--muted)', fontSize: 12 }}
            stroke="var(--axis)" tickMargin={6} interval="preserveStartEnd" reversed />
          <YAxis orientation="right" tick={{ fill: 'var(--muted)', fontSize: 12 }} stroke="var(--axis)" width={64}
            tickFormatter={v => new Intl.NumberFormat('he-IL', { notation: 'compact' }).format(v)} />
          <Tooltip content={<Readout />} cursor={{ fill: 'var(--grid)' }} />
          <Bar dataKey="value" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
