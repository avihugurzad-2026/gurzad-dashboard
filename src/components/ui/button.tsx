import { cn } from '@/lib/utils';

const VARIANTS = {
  primary: 'bg-accent text-white hover:opacity-90',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
} as const;
const SIZES = { sm: 'h-8 px-3 text-sm', md: 'h-9 px-4 text-sm', icon: 'size-9' } as const;

export function buttonClass(variant: keyof typeof VARIANTS = 'secondary', size: keyof typeof SIZES = 'md', className?: string) {
  return cn('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant], SIZES[size], className);
}

export function Button({ variant, size, className, ...props }:
  React.ComponentProps<'button'> & { variant?: keyof typeof VARIANTS; size?: keyof typeof SIZES }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}
