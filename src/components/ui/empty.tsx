import Link from 'next/link';
import { cn } from '@/lib/utils';
import { buttonClass } from './button';

// The one empty state: icon, short title, short explanation, optional action.
export function Empty({ icon, title, children, action, className, compact }: {
  icon?: React.ReactNode; title: string; children?: React.ReactNode;
  action?: { href: string; label: string }; className?: string; compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-center', compact ? 'px-4 py-6' : 'px-6 py-10', className)}>
      {icon && <div className="mb-1 grid size-11 place-items-center rounded-full bg-surface-2 text-muted [&_svg]:size-5">{icon}</div>}
      <p className="text-body font-semibold text-ink">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <Link href={action.href} className={buttonClass('secondary', 'sm', 'mt-2')}>{action.label}</Link>}
    </div>
  );
}
