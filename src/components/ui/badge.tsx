import { cn } from '@/lib/utils';

const TONES = {
  neutral: 'bg-surface-2 text-ink-2 border-line',
  accent: 'bg-accent-soft text-accent-ink border-transparent',
  good: 'bg-good-soft text-good-ink border-transparent',
  warning: 'bg-warning-soft text-warning-ink border-transparent',
  critical: 'bg-critical-soft text-critical-ink border-transparent',
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = 'neutral', className, ...props }: React.ComponentProps<'span'> & { tone?: Tone }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', TONES[tone], className)} {...props} />;
}
