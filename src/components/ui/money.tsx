import { ils, NO_DATA } from '@/lib/format';
import { cn } from '@/lib/utils';

// An amount in ₪ (blurred while "הסתר סכומים" is on). null renders "אין נתונים עדיין", never 0.
export function Money({ value, className, empty = NO_DATA }: { value: number | null | undefined; className?: string; empty?: string }) {
  const text = ils(value);
  if (text === null) return <span className={cn('text-muted', className)}>{empty}</span>;
  return <bdi className={cn('amount tabular', className)}>{text}</bdi>;
}
