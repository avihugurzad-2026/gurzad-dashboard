import Link from 'next/link';
import { CalendarClock, HandCoins, ListChecks, TrendingUp, Wallet } from 'lucide-react';
import { overview, resolveWorkspace, workspaces } from '@/server/data';
import { parseRange, rangeLabel } from '@/lib/period';
import { greeting, ils, longDate, num, shortDate, stamp } from '@/lib/format';
import { Filters } from '@/components/shell/filters';
import { Attention } from '@/components/dash/attention';
import { KpiCard } from '@/components/dash/kpi-card';
import { TrendChart } from '@/components/charts/trend-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';

export const metadata = { title: 'סקירה כללית — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const KIND_LABEL = { task: 'משימה', notice: 'מועד הודעה', payment: 'תשלום' } as const;

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const [ws, branch] = await Promise.all([workspaces(), resolveWorkspace(sp.w)]);
  const d = await overview(branch, range);
  const trend = d.trend.mrr.map((p, i) => ({ period: p.period, mrr: p.value, debts: d.trend.open_debts[i].value }));
  const hasTrend = trend.filter(p => p.mrr !== null || p.debts !== null).length >= 2;
  const horizon = d.horizon.slice(0, 8);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold">{greeting()}, אביהו</h1>
          <p className="text-sm text-muted">{longDate(d.today)}</p>
        </div>
        <Filters workspaces={ws} workspace={branch} range={range} />
      </div>

      {d.missing_params.length > 0 && (
        <Card className="border-warning/40 bg-warning-soft">
          <CardContent className="pt-4 text-sm text-warning-ink">
            חסרים פרמטרים ({d.missing_params.join(', ')}), ולכן חלק מהמספרים לא מוצגים.{' '}
            <Link href="/health" className="font-medium underline">שלמות נתונים</Link>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="הכנסה חודשית קבועה" icon={<TrendingUp className="size-4" />}
          value={ils(d.mrr.net)} href="/finance"
          hint={d.mrr.gross !== null ? `${ils(d.mrr.gross)} כולל מע״מ · ${d.mrr.clients} לקוחות` : undefined}
          reason="אין ריטיינרים פעילים"
          foot={d.concentration ? <>הלקוח הגדול: {d.concentration.max_pct}% מההכנסה</> : null} />

        <KpiCard label="כסף שמחכה לגבייה" icon={<HandCoins className="size-4" />}
          value={ils(d.receivables.total)} href="/finance"
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
          value={d.tasks ? num(d.tasks.overdue) : null} href="/tasks"
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
              <Empty icon={<CalendarClock className="size-6" />} title="אין מועדים בטווח הזה">
                משימות עם תאריך, מועדי הודעה על חידוש ותשלומים קבועים יופיעו כאן.
              </Empty>
            ) : (
              <ul className="flex flex-col divide-y divide-[color:var(--border)]">
                {horizon.map((item, i) => (
                  <li key={`${item.kind}-${i}`} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
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
          <CardHeader><CardTitle>העסקים</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {ws.map(w => (
                <li key={w.branch} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <Link href={`/finance?w=${w.branch}`} className="text-sm font-medium text-ink hover:text-accent">
                    <bdi>{w.name_he || w.branch}</bdi>
                  </Link>
                  {w.entity_count === 0
                    ? <Badge>אין נתונים עדיין</Badge>
                    : <span className="text-xs text-muted">{w.entity_count} רשומות · סונכרן {stamp(w.last_synced)}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>מצב המערכת</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
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
            <Link href="/health" className="mt-1 text-sm font-medium text-accent hover:underline">שלמות נתונים</Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
