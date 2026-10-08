import { cn } from '@/lib/utils';

// White surface on the gray page: 12px radius, hairline border, no shadow. Use a Card for a
// self-contained unit; for plain grouping use <Section> (title + content, no box).
export function Card({ className, ...props }: React.ComponentProps<'section'>) {
  return <section className={cn('rounded-xl border border-line bg-surface', className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-start justify-between gap-3 px-5 pt-5 sm:px-6', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('text-card font-semibold text-ink', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-5 pb-5 pt-4 sm:px-6 sm:pb-6', className)} {...props} />;
}

// A titled group of content without a box
export function Section({ title, action, className, children, ...props }: Omit<React.ComponentProps<'section'>, 'title'> & {
  title: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <section className={cn('flex flex-col gap-4', className)} {...props}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-section font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
