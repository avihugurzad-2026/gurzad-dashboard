import { useId, useState } from 'react';
import { motion } from 'motion/react';
import { easeOut } from './kit';
import { money, monthName } from '../lib/format';

// transform-only bar growth (GPU) instead of animating y/height attributes
const grow = { transformBox: 'fill-box', transformOrigin: 'bottom' } as const;

/** Bars: solid = actual, hatched = second series stacked above (e.g. expense vs income, forecast). */
export function BarChart({ data, aLabel, bLabel, height = 190, width = 520 }: { data: { month: string; a: number; b?: number }[]; aLabel: string; bLabel?: string; height?: number; width?: number }) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const W = width, H = height, padB = 26, padT = 12;
  const max = Math.max(1, ...data.map((d) => Math.max(d.a, d.b ?? 0)));
  const slot = W / data.length;
  const bw = Math.min(34, slot * 0.34);
  const y = (v: number) => padT + (H - padB - padT) * (1 - v / max);
  const cur = hover ?? data.length - 1;
  return (
    <div>
      <div className="spread" style={{ marginBottom: 10 }}>
        <div className="legend">
          <span><i style={{ background: 'var(--chart-1)' }} />{aLabel}</span>
          {bLabel && <span><i style={{ background: `repeating-linear-gradient(-45deg, var(--chart-2) 0 2px, transparent 2px 4px)`, border: '1px solid var(--chart-2)' }} />{bLabel}</span>}
        </div>
        <div className="meta num" aria-live="polite">
          {data[cur] && <>{monthName(data[cur].month)} · {money(data[cur].a)}{bLabel && data[cur].b != null ? ` / ${money(data[cur].b!)}` : ''}</>}
        </div>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${aLabel}${bLabel ? ' מול ' + bLabel : ''} לפי חודש`} style={{ direction: 'ltr' }}>
        <defs>
          <pattern id={`h${id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--surface-3)" />
            <rect width="2.4" height="6" fill="var(--chart-2)" />
          </pattern>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1="0" x2={W} y1={y(max * t)} y2={y(max * t)} stroke="var(--line)" strokeDasharray="2 5" />)}
        {data.map((d, i) => {
          const cx = W - (slot * i + slot / 2); // RTL: oldest month on the right, newest on the left
          const two = d.b != null;
          const ax = two ? cx + 2 : cx - bw / 2;
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} style={{ outline: 'none' }} opacity={hover == null || hover === i ? 1 : 0.55}>
              <rect x={cx - slot / 2} y="0" width={slot} height={H} fill="transparent" />
              <motion.rect x={ax} y={y(d.a)} height={Math.max(0, y(0) - y(d.a))} width={bw} rx="7" fill="var(--chart-1)" style={grow} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.32, ease: easeOut, delay: 0.04 + i * 0.025 }} />
              {two && <motion.rect x={cx - bw - 2} y={y(d.b!)} height={Math.max(0, y(0) - y(d.b!))} width={bw} rx="7" fill={`url(#h${id})`} style={grow} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.32, ease: easeOut, delay: 0.06 + i * 0.025 }} />}
              <text x={cx} y={H - 6} textAnchor="middle" style={i === cur ? { fill: 'var(--ink)', fontWeight: 500 } : undefined}>{monthName(d.month)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Spark({ values, width = 96, height = 30 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [width - (i / (values.length - 1)) * width, height - 3 - ((v - min) / span) * (height - 6)]);
  const dPath = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ direction: 'ltr', overflow: 'visible' }}>
      <motion.path d={dPath} fill="none" stroke="var(--chart-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, ease: easeOut, delay: 0.1 }} />
      <circle cx={last[0]} cy={last[1]} r="3.2" fill="var(--chart-1)" />
    </svg>
  );
}

/** Dot-matrix strip (inspiration: health dashboard). One dot column per value. */
export function DotStrip({ values, rows = 5 }: { values: number[]; rows?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div aria-hidden style={{ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: `repeat(${rows}, 5px)`, gap: 3, direction: 'rtl', justifyContent: 'start' }}>
      {values.flatMap((v, c) => Array.from({ length: rows }, (_, r) => {
        const on = rows - r <= Math.max(1, Math.round((v / max) * rows));
        return <i key={`${c}-${r}`} style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', opacity: on ? 0.95 : 0.22 }} />;
      }))}
    </div>
  );
}
