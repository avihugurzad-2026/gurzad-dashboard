'use client';
import { useId } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ils } from '@/lib/format';

export type DayPoint = { day: string; value: number | null };

const dayFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayLabel = (iso: string) => dayFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

function Readout({ active, payload, label }: { active?: boolean; payload?: { value?: number | null }[]; label?: string }) {
  const v = payload?.[0]?.value;
  if (!active || v === null || v === undefined) return null;
  return (
    <div dir="rtl" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-card">
      <p className="mb-0.5 text-xs text-muted">{dayLabel(String(label))}</p>
      <bdi className="font-semibold tabular amount">{ils(v)}</bdi>
    </div>
  );
}

// One series per day, one ₪ axis (same marks as MonthlyBars). A day with no data has no bar.
export function DailyBars({ data, caption }: { data: DayPoint[]; caption: string }) {
  const titleId = useId();
  return (
    <div className="h-52 w-full" dir="ltr" role="img" aria-labelledby={titleId}>
      <span id={titleId} className="sr-only">{caption}</span>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
          <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fill: 'var(--muted)', fontSize: 13 }}
            stroke="var(--axis)" tickMargin={6} interval="preserveStartEnd" minTickGap={24} reversed />
          <YAxis orientation="right" tick={{ fill: 'var(--muted)', fontSize: 13 }} stroke="var(--axis)" width={56}
            tickFormatter={v => new Intl.NumberFormat('he-IL', { notation: 'compact' }).format(v)} />
          <Tooltip content={<Readout />} cursor={{ fill: 'var(--grid)' }} />
          <Bar dataKey="value" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={20} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
