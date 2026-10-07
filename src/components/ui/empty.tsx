import Link from 'next/link';
import { cn } from '@/lib/utils';

// Every empty screen says what is missing and what to do about it
export function Empty({ icon, title, children, action, className }: {
  icon?: React.ReactNode; title: string; children?: React.ReactNode;
  action?: { href: string; label: string }; className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-8 text-center', className)}>
      {icon && <div className="text-muted">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <Link href={action.href} className="mt-1 text-sm font-medium text-accent hover:underline">{action.label}</Link>}
    </div>
  );
}
