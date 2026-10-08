import { cn } from '@/lib/utils';

// One button for the product. primary = the screen's main action (blue, one per area of a screen),
// secondary = everything else that matters, ghost = light actions and icons, danger = destructive.
const VARIANTS = {
  primary: 'bg-accent text-white hover:bg-accent-ink',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'border border-critical/30 bg-surface text-critical-ink hover:bg-critical-soft',
} as const;
// Heights: sm 32, md 36 (top bar and forms), lg 40. Icons inside are 16px.
const SIZES = { sm: 'h-8 px-3 text-sm', md: 'h-9 px-4 text-sm', lg: 'h-10 px-5 text-body', icon: 'size-9' } as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string) {
  return cn('inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
    VARIANTS[variant], SIZES[size], className);
}

export function Button({ variant, size, className, type = 'button', ...props }:
  React.ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}
