import Link from 'next/link';
import { NO_DATA } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { PrivacySlot, PrivacyValue } from '@/components/shell/privacy-value';

// One KPI. `value` already formatted; null → "אין נתונים עדיין" plus the reason, never 0.
export function KpiCard({ label, value, hint, reason, href, icon, amount = true, foot, className }: {
  label: string; value: string | null; hint?: React.ReactNode; reason?: string;
  href?: string; icon?: React.ReactNode; amount?: boolean; foot?: React.ReactNode; className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink-2">{label}</p>
        {icon && <span className="text-muted [&_svg]:size-4">{icon}</span>}
      </div>
      {value === null ? (
        <p className="mt-3 text-body text-muted">{NO_DATA}</p>
      ) : (
        <p className={cn('mt-2 text-kpi font-bold text-ink tabular')}>
          {amount ? <PrivacyValue><bdi>{value}</bdi></PrivacyValue> : <bdi>{value}</bdi>}
        </p>
      )}
      {value !== null && hint && <PrivacySlot><p className="mt-1.5 text-sm text-muted">{hint}</p></PrivacySlot>}
      {value === null && reason && <p className="mt-1 text-xs text-muted">{reason}</p>}
      {foot && <div className="mt-4 border-t border-line pt-3 text-xs text-muted">{foot}</div>}
    </>
  );
  const pad = 'block p-5 sm:p-6';
  return href
    ? <Card className={cn('transition-colors hover:border-line-strong', className)}><Link href={href} className={cn(pad, 'rounded-xl')}>{body}</Link></Card>
    : <Card className={cn(pad, className)}>{body}</Card>;
}
