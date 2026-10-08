import Link from 'next/link';
import { Rocket } from 'lucide-react';
import { ils, num, NO_DATA } from '@/lib/format';
import type { VenturesSummary } from '@/server/ventures';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, Section } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function Metric({ label, value, sub, amount = true }: { label: string; value: string | null; sub?: string; amount?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-ink-2">{label}</p>
      {value === null ? <p className="mt-2 text-body text-muted">{NO_DATA}</p>
        : <p className={cn('mt-1.5 text-kpi font-bold text-ink tabular', amount && 'amount')}><bdi>{value}</bdi></p>}
      {value !== null && sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function TaskLine({ open, urgent, overdue }: { open: number; urgent: number; overdue: number }) {
  if (!open) return <p className="text-sm text-muted">אין משימות פתוחות</p>;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
      <span>{num(open)} משימות פתוחות</span>
      {urgent > 0 && <Badge tone="warning">{num(urgent)} דחופות</Badge>}
      {overdue > 0 && <Badge tone="critical">{num(overdue)} באיחור</Badge>}
    </p>
  );
}

export function VenturesSnapshot({ s }: { s: VenturesSummary }) {
  const est = s.properties.has_estimate || s.investments.has_estimate;
  const next = s.legal.next_deadline;
  return (
    <Section title={<><Rocket className="size-[18px] text-muted" aria-hidden />תמונת מצב יזמות</>}>
      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-5 pt-5 sm:pt-6 md:grid-cols-4">
          <Link href="/ventures/real-estate" className="-m-2 rounded-lg p-2 transition-colors hover:bg-surface-2">
            <Metric label="הון עצמי בנכסים" value={ils(s.equity)} sub={`${num(s.properties.count)} נכסים${s.properties.has_estimate ? ' · שווי לפי הערכה' : ''}`} />
          </Link>
          <Link href="/ventures/real-estate" className="-m-2 rounded-lg p-2 transition-colors hover:bg-surface-2">
            <Metric label="יתרת הלוואות" value={ils(s.loans.balance)} sub={s.loans.monthly_payment !== null ? `החזר חודשי ${ils(s.loans.monthly_payment)}` : undefined} />
          </Link>
          <Link href="/ventures/investments" className="-m-2 rounded-lg p-2 transition-colors hover:bg-surface-2">
            <Metric label="שווי השקעות" value={ils(s.investments.value)} sub={s.investments.gain !== null ? `רווח ${ils(s.investments.gain)}` : undefined} />
          </Link>
          <Link href="/ventures/legal-and-tasks" className="-m-2 rounded-lg p-2 transition-colors hover:bg-surface-2">
            <p className="text-sm font-medium text-ink-2">תיקים משפטיים</p>
            <p className="mt-1.5 text-kpi font-bold text-ink tabular">{num(s.legal.open)}</p>
            {s.legal.overdue_deadlines > 0 ? <p className="mt-1 text-xs text-critical-ink">{num(s.legal.overdue_deadlines)} מועדים באיחור</p>
              : next ? <p className="mt-1 truncate text-xs text-muted">הבא: {next.title}</p> : <p className="mt-1 text-xs text-muted">אין מועדים קרובים</p>}
          </Link>
        </CardContent>
      </Card>
      {est && <p className="text-xs text-muted">חלק מהשווי מבוסס הערכה ולא שמאות או דוח.</p>}
    </Section>
  );
}
