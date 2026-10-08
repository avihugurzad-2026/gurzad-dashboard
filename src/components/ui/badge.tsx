import { cn } from '@/lib/utils';

// One badge for the product: pill, 24px, 13px medium. accent = context (where a thing belongs),
// critical = overdue/urgent, warning = high/waiting, good = done/ok, neutral = everything else.
const TONES = {
  neutral: 'bg-surface-2 text-ink-2',
  accent: 'bg-accent-soft text-accent-ink',
  good: 'bg-good-soft text-good-ink',
  warning: 'bg-warning-soft text-warning-ink',
  critical: 'bg-critical-soft text-critical-ink',
} as const;

export type Tone = keyof typeof TONES;

export const badgeClass = (tone: Tone = 'neutral', className?: string) =>
  cn('inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-medium [&_svg]:size-3.5', TONES[tone], className);

export function Badge({ tone = 'neutral', className, ...props }: React.ComponentProps<'span'> & { tone?: Tone }) {
  return <span className={badgeClass(tone, className)} {...props} />;
}
