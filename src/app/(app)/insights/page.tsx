import Link from 'next/link';
import { requireAdmin } from '@/server/auth';
import { CalendarClock, HandCoins, ListChecks, TrendingUp, Wallet } from 'lucide-react';
import { overview, resolveWorkspace, workspaces } from '@/server/data';
import { openCounts } from '@/server/entries';
import { parseRange, rangeLabel } from '@/lib/period';
import { ils, longDate, num, shortDate, stamp } from '@/lib/format';
import { Filters } from '@/components/shell/filters';
import { Attention } from '@/components/dash/attention';
import { KpiCard } from '@/components/dash/kpi-card';
import { TrendChart } from '@/components/charts/trend-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';
import { buttonClass } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/page-header';

export const metadata = { title: 'סקירה עסקית — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const KIND_LABEL = { task: 'משימה', notice: 'מועד הודעה', payment: 'תשלום' } as const;

// The three areas, each linking to its pages; counts come from openCounts() keys
const AREAS = [
  { title: 'עסקים', items: [
    { label: 'a-digital', href: '/business/adigital', key: 'business/adigital' },
    { label: 'Head Spa Israel', href: '/business/head-spa-israel', key: 'business/head-spa-israel' },
  ] },
  { title: 'אישי', items: [
    { label: 'משימות בית, אישי ולימודים', href: '/personal/tasks', key: 'personal' },
  ] },
  { title: 'יזמות', items: [
    { label: 'נכסים', href: '/ventures/real-estate', key: 'ventures/real-estate' },
    { label: 'השקעות', href: '/ventures/investments', key: 'ventures/investments' },
    { label: 'משפטי', href: '/ventures/legal-and-tasks', key: 'ventures/legal-and-tasks' },
    { label: 'פיננסים', href: '/ventures/finance', key: 'ventures/finance' },
  ] },
];

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const [ws, branch, counts] = await Promise.all([workspaces(), resolveWorkspace(sp.w), openCounts()]);
  const d = await overview(branch, range);
  const trend = d.trend.mrr.map((p, i) => ({ period: p.period, mrr: p.value, debts: d.trend.open_debts[i].value }));
  const hasTrend = trend.filter(p => p.mrr !== null || p.debts !== null).length >= 2;
  const horizon = d.horizon.slice(0, 8);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="סקירה עסקית" subtitle={longDate(d.today)}
        actions={<Filters workspaces={ws} workspace={branch} range={range} />} />

      {d.missing_params.length > 0 && (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          חסרים פרמטרים (<bdi>{d.missing_params.join(', ')}</bdi>), ולכן חלק מהמספרים לא מוצגים.{' '}
          <Link href="/health" className="font-medium underline">שלמות נתונים</Link>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="הכנסה חודשית קבועה" icon={<TrendingUp className="size-4" />}
          value={ils(d.mrr.net)} href="/business/adigital?tab=clients"
          hint={d.mrr.gross !== null ? `${ils(d.mrr.gross)} כולל מע״מ · ${d.mrr.clients} לקוחות` : undefined}
          reason="אין ריטיינרים פעילים"
          foot={d.concentration ? <>הלקוח הגדול: {d.concentration.max_pct}% מההכנסה</> : null} />

        <KpiCard label="כסף שמחכה לגבייה" icon={<HandCoins className="size-4" />}
          value={ils(d.receivables.total)} href="/business/adigital?tab=collections"
          hint={`${d.receivables.count} יתרות · ${d.receivables.clients} לקוחות`}
          reason="אין יתרות פתוחות"
          foot={d.receivables.oldest_due
            ? <>הוותיקה ביותר: {shortDate(d.receivables.oldest_due)} ({d.receivables.oldest_days} ימים)</>
            : d.receivables.count > 0 ? <>לאף יתרה אין תאריך לתשלום</> : null} />

        <KpiCard label="מזומן תפעולי" icon={<Wallet className="size-4" />}
          value={ils(d.cash.operating)} href="/review"
          hint={d.cash.weeks_of_spend !== null ? `מכסה ${d.cash.weeks_of_spend} שבועות הוצאה` : undefined}
          reason="אין רשומות cash-account בוואלט"
          foot={d.cash.trough
            ? <>שפל צפוי: {shortDate(d.cash.trough.week)} · {ils(d.cash.trough.amount)}{d.cash.below_floor ? ' · מתחת לרצפה' : ''}</>
            : null} />

        <KpiCard label="משימות באיחור" icon={<ListChecks className="size-4" />} amount={false}
          value={d.tasks ? num(d.tasks.overdue) : null} href="/personal/tasks"
          hint={d.tasks ? `מתוך ${d.tasks.open} משימות פתוחות` : undefined}
          reason="עוד לא סונכרנו משימות" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Attention items={d.attention.items} more={d.attention.more}
          snoozed={d.attention.snoozed} evaluated={d.attention.evaluated} />

        <Card>
          <CardHeader>
            <CardTitle>לפניך</CardTitle>
            <span className="text-sm text-muted">{rangeLabel(range)}</span>
          </CardHeader>
          <CardContent>
            {horizon.length === 0 ? (
              <Empty icon={<CalendarClock />} title="אין מועדים בטווח הזה">
                משימות עם תאריך, מועדי הודעה על חידוש ותשלומים קבועים יופיעו כאן.
              </Empty>
            ) : (
              <ul className="flex flex-col divide-y divide-[color:var(--border)]">
                {horizon.map((item, i) => (
                  <li key={`${item.kind}-${i}`} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink"><bdi>{item.title}</bdi></p>
                      <p className="text-xs text-muted">{KIND_LABEL[item.kind]} · {shortDate(item.date)}</p>
                    </div>
                    {item.amount != null && <Money value={item.amount} className="shrink-0 text-sm text-ink-2" />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>מגמה שבועית</CardTitle>
          <span className="text-sm text-muted">13 שבועות</span>
        </CardHeader>
        <CardContent>
          {hasTrend ? <TrendChart data={trend} /> : (
            <Empty title="צריך עוד שבוע אחד" action={{ href: '/health', label: 'מצב הסנכרון' }}>
              כל סנכרון שומר תמונת מצב שבועית. יש כרגע שבוע אחד, והגרף יופיע כשיהיו שניים.
            </Empty>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>האזורים</CardTitle><span className="text-sm text-muted">משימות פתוחות</span></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {AREAS.map(a => (
              <section key={a.title} aria-label={a.title}>
                <h3 className="mb-1 text-xs font-semibold text-muted">{a.title}</h3>
                <ul className="flex flex-col divide-y divide-[color:var(--border)]">
                  {a.items.map(it => {
                    const c = counts[it.key];
                    return (
                      <li key={it.href} className="flex items-center justify-between gap-3 py-3">
                        <Link href={it.href} className="text-sm font-medium text-ink hover:text-accent"><bdi>{it.label}</bdi></Link>
                        {c?.open
                          ? <span className="text-xs text-muted">{c.open} פתוחות{c.overdue ? <span className="text-critical-ink"> · {c.overdue} באיחור</span> : null}</span>
                          : <span className="text-xs text-muted">אין משימות פתוחות</span>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>מצב המערכת</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-2">סנכרון אחרון</span>
              <span className="text-muted">{d.attention.last_sync ? stamp(d.attention.last_sync) : 'עוד לא רץ'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-2">סקירה שבועית אחרונה</span>
              <span className="text-muted">{d.attention.last_review ? stamp(d.attention.last_review) : 'עוד לא נעשתה'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-2">מע״מ</span>
              <span className="text-muted">{d.vat_rate !== null ? `${Math.round(d.vat_rate * 100)}%` : 'חסר פרמטר'}</span>
            </div>
            <div className="mt-1"><Link href="/health" className={buttonClass('secondary', 'sm')}>שלמות נתונים</Link></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
