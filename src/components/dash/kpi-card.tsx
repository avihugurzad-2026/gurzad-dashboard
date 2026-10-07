import Link from 'next/link';
import { NO_DATA } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// One KPI. `value` already formatted; null → "אין נתונים עדיין" plus the reason, never 0.
export function KpiCard({ label, value, hint, reason, href, icon, amount = true, foot }: {
  label: string; value: string | null; hint?: string; reason?: string;
  href?: string; icon?: React.ReactNode; amount?: boolean; foot?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-2">{label}</p>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      {value === null ? (
        <p className="mt-2 text-sm text-muted">{NO_DATA}</p>
      ) : (
        <p className={cn('mt-2 text-kpi font-semibold text-ink tabular', amount && 'amount')}>
          <bdi>{value}</bdi>
        </p>
      )}
      {value !== null && hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      {value === null && reason && <p className="mt-1 text-xs text-muted">{reason}</p>}
      {foot && <div className="mt-3 border-t border-line pt-2 text-xs text-muted">{foot}</div>}
    </>
  );
  const className = 'block p-5 transition-colors';
  return href
    ? <Card className="hover:border-line-strong"><Link href={href} className={className}>{body}</Link></Card>
    : <Card className={className}>{body}</Card>;
}
