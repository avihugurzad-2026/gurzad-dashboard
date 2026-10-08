import Link from 'next/link';
import { Briefcase, ChevronLeft, Rocket, User } from 'lucide-react';
import { ils, num, NO_DATA } from '@/lib/format';
import type { BusinessCard, PersonalCard } from '@/server/snapshot';
import type { VenturesSummary } from '@/server/ventures';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, Section } from '@/components/ui/card';
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

function TaskLine({ open, urgent, overdue }: { open: number; urgent: number; overdue: number }) {
  if (!open) return <p className="text-sm text-muted">אין משימות פתוחות</p>;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
      <span>{num(open)} משימות פתוחות</span>
      {urgent > 0 && <Badge tone="warning">{num(urgent)} דחופות</Badge>}
      {overdue > 0 && <Badge tone="critical">{num(overdue)} באיחור</Badge>}
    </p>
  );
}

export function BusinessSnapshot({ cards, periodLabel }: { cards: BusinessCard[]; periodLabel: string }) {
  return (
    <Section title={<><Briefcase className="size-[18px] text-muted" aria-hidden />תמונת מצב עסקית</>}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0">
        {cards.map(c => (
          <Card key={c.branch}>
            <CardHeader>
              <CardTitle><bdi>{c.label}</bdi></CardTitle>
              <Link href={c.href} className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-accent-ink hover:underline">לדשבורד<ChevronLeft className="size-4" aria-hidden /></Link>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {c.revenue && (
                <div className="grid grid-cols-2 gap-4">
                  <Metric label={`הכנסות ${periodLabel}`} value={ils(c.revenue.net)} sub={c.revenue.count ? `${num(c.revenue.count)} תנועות · בלי מע״מ` : undefined} />
                  <Metric label="הכנסות היום" value={ils(c.revenue.today)} />
                </div>
              )}
              {c.revenue && c.revenueSource === 'buyz' && <p className="text-xs text-muted">מכירות מ-Buyz</p>}
              <TaskLine open={c.open} urgent={c.urgent} overdue={c.overdue} />
            </CardContent>
          </Card>
        ))}
      </div>
    </Section>
  );
}

export function PersonalSnapshot({ card, events, periodLabel }: { card: PersonalCard; events: number | null; periodLabel: string }) {
  const g = card.goal;
  return (
    <Section title={<><User className="size-[18px] text-muted" aria-hidden />תמונת מצב אישית</>}>
      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-5 pt-5 sm:pt-6 md:grid-cols-4">
          {card.moneyAccess && (
            <Link href="/personal/finance" className="-m-2 rounded-lg p-2 transition-colors hover:bg-surface-2">
              <Metric label={`הוצאות ${periodLabel}`} value={ils(card.expenses)} sub={card.expenseCount ? `${num(card.expenseCount)} תנועות` : undefined} />
            </Link>
          )}
          <Link href="/personal" className="-m-2 rounded-lg p-2 transition-colors hover:bg-surface-2">
            <Metric label="משימות השבוע" amount={false} value={num(card.weekTasks)} sub={card.weekOverdue ? `${num(card.weekOverdue)} באיחור` : 'שום דבר לא באיחור'} />
          </Link>
          <Link href="/calendar?view=week" className="-m-2 rounded-lg p-2 transition-colors hover:bg-surface-2">
            <Metric label="אירועים השבוע" amount={false} value={num(events)} />
          </Link>
          <Link href="/goals?type=financial" className="col-span-2 -m-2 rounded-lg p-2 transition-colors hover:bg-surface-2 md:col-span-1">
            <p className="text-sm font-medium text-ink-2">יעד פיננסי</p>
            {!g ? <p className="mt-2 text-body text-muted">אין יעד פיננסי פעיל</p> : (
              <div className="mt-2 flex flex-col gap-2">
                <p className="truncate text-body font-medium text-ink"><bdi>{g.title}</bdi></p>
                {g.pct !== null ? (
                  <>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={g.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`התקדמות ${g.title}`}>
                      <div className="h-full rounded-full bg-accent" style={{ inlineSize: `${g.pct}%` }} />
                    </div>
                    <p className="text-xs text-muted tabular"><bdi className="amount">{g.unit === 'ils' ? ils(g.current) : num(g.current)}</bdi> מתוך <bdi className="amount">{g.unit === 'ils' ? ils(g.target) : num(g.target)}</bdi> · {g.pct}%</p>
                  </>
                ) : <p className="text-xs text-muted">{NO_DATA}</p>}
              </div>
            )}
          </Link>
        </CardContent>
      </Card>
    </Section>
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
