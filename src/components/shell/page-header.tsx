import { Suspense } from 'react';
import { Breadcrumb } from './breadcrumb';
import { cn } from '@/lib/utils';

// The one page header: breadcrumb, title (with an optional status badge), subtitle, actions on the
// inline-end, and optional tabs underneath. Every main page starts with it.
export function PageHeader({ title, subtitle, status, actions, tabs, crumb, breadcrumb = true, className }: {
  title: React.ReactNode; subtitle?: React.ReactNode; status?: React.ReactNode; actions?: React.ReactNode;
  tabs?: React.ReactNode; crumb?: string; breadcrumb?: boolean; className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-2">
        {breadcrumb && <Suspense fallback={<div className="h-5" />}><Breadcrumb extra={crumb} /></Suspense>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-title font-bold text-ink"><bdi>{title}</bdi></h1>
              {status}
            </div>
            {subtitle && <p className="text-body text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
        </div>
      </div>
      {tabs}
    </header>
  );
}
