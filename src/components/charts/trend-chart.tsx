'use client';
import { useId } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ils, weekLabel } from '@/lib/format';

export type TrendPoint = { period: string; mrr: number | null; debts: number | null };

const SERIES = [
  { key: 'mrr', name: 'הכנסה חודשית קבועה', color: 'var(--series-1)' },
  { key: 'debts', name: 'יתרות לגבייה', color: 'var(--series-2)' },
] as const;

function Readout({ active, payload, label }: { active?: boolean; payload?: { dataKey?: string | number; value?: number | null }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div dir="rtl" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-card">
      <p className="mb-1 text-xs text-muted">{weekLabel(String(label))}</p>
      {SERIES.map(s => {
        const p = payload.find(x => x.dataKey === s.key);
        if (!p || p.value === null || p.value === undefined) return null;
        return (
          <p key={s.key} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 rounded" style={{ background: s.color }} />
            <bdi className="font-semibold tabular amount">{ils(p.value)}</bdi>
            <span className="text-muted">{s.name}</span>
          </p>
        );
      })}
    </div>
  );
}

// Two measures on one ₪ axis (never a second scale). A week with no snapshot is a gap, not 0.
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const titleId = useId();
  return (
    <figure className="m-0">
      <figcaption className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {SERIES.map(s => (
          <span key={s.key} className="flex items-center gap-1.5 text-ink-2">
            <span aria-hidden className="h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </figcaption>
      <div className="h-56 w-full" dir="ltr" role="img" aria-labelledby={titleId}>
        <span id={titleId} className="sr-only">מגמה שבועית של ההכנסה הקבועה ושל היתרות לגבייה, 13 שבועות</span>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--grid)" strokeWidth={1} vertical={false} />
            <XAxis dataKey="period" tickFormatter={weekLabel} tick={{ fill: 'var(--muted)', fontSize: 13 }}
              stroke="var(--axis)" tickMargin={6} interval="preserveStartEnd" reversed />
            <YAxis orientation="right" tick={{ fill: 'var(--muted)', fontSize: 13 }} stroke="var(--axis)" width={64}
              tickFormatter={v => new Intl.NumberFormat('he-IL', { notation: 'compact' }).format(v)} />
            <Tooltip content={<Readout />} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} />
            {SERIES.map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2}
                dot={{ r: 3, strokeWidth: 0, fill: s.color }} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
                connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
