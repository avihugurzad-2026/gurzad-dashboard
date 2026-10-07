import Link from 'next/link';
import { Briefcase, ChevronLeft, Rocket, User } from 'lucide-react';
import { ils, num, NO_DATA } from '@/lib/format';
import type { BusinessCard, PersonalCard } from '@/server/snapshot';
import type { VenturesSummary } from '@/server/ventures';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function Metric({ label, value, sub, amount = true }: { label: string; value: string | null; sub?: string; amount?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-ink-2">{label}</p>
      {value === null ? <p className="mt-1 text-sm text-muted">{NO_DATA}</p>
        : <p className={cn('mt-1 text-kpi font-semibold leading-tight text-ink tabular', amount && 'amount')}><bdi>{value}</bdi></p>}
      {value !== null && sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function TaskLine({ open, urgent, overdue }: { open: number; urgent: number; overdue: number }) {
  if (!open) return <p className="text-sm text-muted">אין משימות פתוחות</p>;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
      <span>{num(open)} משימות פתוחות</span>
      {urgent > 0 && <span className="rounded-full bg-warning-soft px-2 text-xs text-warning-ink">{num(urgent)} דחופות</span>}
      {overdue > 0 && <span className="rounded-full bg-critical-soft px-2 text-xs text-critical-ink">{num(overdue)} באיחור</span>}
    </p>
  );
}

export function BusinessSnapshot({ cards, periodLabel }: { cards: BusinessCard[]; periodLabel: string }) {
  return (
    <section aria-labelledby="biz-snap" className="flex flex-col gap-3">
      <h2 id="biz-snap" className="flex items-center gap-2 text-section font-semibold"><Briefcase className="size-5 text-muted" aria-hidden />תמונת מצב עסקית</h2>
      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 [&>*]:min-w-0">
        {cards.map(c => (
          <Card key={c.branch}>
            <CardHeader>
              <CardTitle><bdi>{c.label}</bdi></CardTitle>
              <Link href={c.href} className="flex items-center gap-0.5 text-sm text-accent hover:underline">לדשבורד<ChevronLeft className="size-4" aria-hidden /></Link>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {c.revenue && (
                <div className="grid grid-cols-2 gap-3">
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
    </section>
  );
}

export function PersonalSnapshot({ card, events, periodLabel }: { card: PersonalCard; events: number | null; periodLabel: string }) {
  const g = card.goal;
  return (
    <section aria-labelledby="me-snap" className="flex flex-col gap-3">
      <h2 id="me-snap" className="flex items-center gap-2 text-section font-semibold"><User className="size-5 text-muted" aria-hidden />תמונת מצב אישית</h2>
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-5 md:grid-cols-4">
          {card.moneyAccess && (
            <Link href="/personal/finance" className="rounded-lg hover:bg-surface-2">
              <Metric label={`הוצאות ${periodLabel}`} value={ils(card.expenses)} sub={card.expenseCount ? `${num(card.expenseCount)} תנועות` : undefined} />
            </Link>
          )}
          <Link href="/personal" className="rounded-lg hover:bg-surface-2">
            <Metric label="משימות השבוע" amount={false} value={num(card.weekTasks)} sub={card.weekOverdue ? `${num(card.weekOverdue)} באיחור` : 'שום דבר לא באיחור'} />
          </Link>
          <Link href="/calendar?view=week" className="rounded-lg hover:bg-surface-2">
            <Metric label="אירועים השבוע" amount={false} value={num(events)} />
          </Link>
          <Link href="/goals?type=financial" className="col-span-2 rounded-lg hover:bg-surface-2 md:col-span-1">
            <p className="text-sm text-ink-2">יעד פיננסי</p>
            {!g ? <p className="mt-1 text-sm text-muted">אין יעד פיננסי פעיל</p> : (
              <div className="mt-1 flex flex-col gap-1.5">
                <p className="truncate text-[15px] font-medium text-ink">{g.title}</p>
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
    </section>
  );
}

export function VenturesSnapshot({ s }: { s: VenturesSummary }) {
  const est = s.properties.has_estimate || s.investments.has_estimate;
  const next = s.legal.next_deadline;
  return (
    <section aria-labelledby="ven-snap" className="flex flex-col gap-3">
      <h2 id="ven-snap" className="flex items-center gap-2 text-section font-semibold"><Rocket className="size-5 text-muted" aria-hidden />תמונת מצב יזמות</h2>
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-5 md:grid-cols-4">
          <Link href="/ventures/real-estate" className="rounded-lg hover:bg-surface-2">
            <Metric label="הון עצמי בנכסים" value={ils(s.equity)} sub={`${num(s.properties.count)} נכסים${s.properties.has_estimate ? ' · שווי לפי הערכה' : ''}`} />
          </Link>
          <Link href="/ventures/real-estate" className="rounded-lg hover:bg-surface-2">
            <Metric label="יתרת הלוואות" value={ils(s.loans.balance)} sub={s.loans.monthly_payment !== null ? `החזר חודשי ${ils(s.loans.monthly_payment)}` : undefined} />
          </Link>
          <Link href="/ventures/investments" className="rounded-lg hover:bg-surface-2">
            <Metric label="שווי השקעות" value={ils(s.investments.value)} sub={s.investments.gain !== null ? `רווח ${ils(s.investments.gain)}` : undefined} />
          </Link>
          <Link href="/ventures/legal-and-tasks" className="rounded-lg hover:bg-surface-2">
            <p className="text-sm text-ink-2">תיקים משפטיים</p>
            <p className="mt-1 text-kpi font-semibold leading-tight text-ink tabular">{num(s.legal.open)}</p>
            {s.legal.overdue_deadlines > 0 ? <p className="mt-0.5 text-xs text-critical-ink">{num(s.legal.overdue_deadlines)} מועדים באיחור</p>
              : next ? <p className="mt-0.5 truncate text-xs text-muted">הבא: {next.title}</p> : <p className="mt-0.5 text-xs text-muted">אין מועדים קרובים</p>}
          </Link>
        </CardContent>
      </Card>
      {est && <p className="text-xs text-muted">חלק מהשווי מבוסס הערכה ולא שמאות או דוח.</p>}
    </section>
  );
}
