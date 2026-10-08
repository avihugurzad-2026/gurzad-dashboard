import Link from 'next/link';
import { Building2 } from 'lucide-react';
import type { HeadSpaData } from '@/server/headspa';
import { num, stamp } from '@/lib/format';
import { MonthlyBars } from '@/components/charts/monthly-bars';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';
import { HeadSpaKpis, IntegrationBadge, VatNote, type GoalsSummary } from './parts';

// Company level of Head Spa Israel: every branch in the registry, summed, then compared side by side
export function CompanyOverview({ d, goals, counts }: {
  d: HeadSpaData; goals: GoalsSummary; counts: Record<string, { open: number; overdue: number }>;
}) {
  const mine = d.basis === 'mine';
  const asOf = d.branches.map(b => b.as_of).filter(Boolean).sort().at(-1) ?? null;
  const chart = d.monthly.slice(-12).map(m => ({ month: m.month, value: m.value }));
  const q = mine ? '?basis=mine' : '';
  return (
    <div className="flex flex-col gap-6">
      <HeadSpaKpis n={{ ...d.total, avg_ticket_incl: d.total.avg_ticket_incl }} goals={goals} mine={mine} asOf={asOf} money={d.can_see_money} />

      <Card>
        <CardHeader>
          <CardTitle>ביצועים לפי סניף</CardTitle>
          <span className="text-sm text-muted">{mine ? 'החלק שלי' : '100% מהעסק'} · לפני מע״מ</span>
        </CardHeader>
        <CardContent>
          {d.branches.length === 0 ? (
            <Empty icon={<Building2 />} title="אין סניפים מוגדרים">סניף נוסף נוצר בשורה בטבלת locations.</Empty>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="data-table min-w-[640px]">
                <caption className="sr-only">השוואת סניפים: הכנסה היום, החודש, חודש קודם, עסקאות וטיפולים</caption>
                <thead><tr>
                  <th scope="col">סניף</th>
                  <th scope="col" className="num">היום</th>
                  <th scope="col" className="num">החודש</th>
                  <th scope="col" className="num">חודש קודם</th>
                  <th scope="col" className="num">עסקאות</th>
                  <th scope="col" className="num">טיפולים</th>
                  <th scope="col" className="num">משימות פתוחות</th>
                </tr></thead>
                <tbody>
                  {d.branches.map(b => {
                    const t = counts[`business/head-spa-israel/${b.location}`];
                    return (
                      <tr key={b.location}>
                        <td>
                          <Link href={`${b.href}${q}`} className="font-medium text-ink hover:underline">סניף <bdi>{b.name_he}</bdi></Link>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {b.status === 'setup' && <Badge tone="warning">בהקמה</Badge>}
                            <IntegrationBadge i={b.integration} />
                          </div>
                        </td>
                        <td className="num"><Money value={b.numbers.today_ex} /></td>
                        <td className="num"><Money value={b.numbers.month_ex} className="font-medium" /></td>
                        <td className="num"><Money value={b.numbers.last_month_ex} /></td>
                        <td className="num">{num(b.numbers.tx) ?? <span className="text-muted">–</span>}</td>
                        <td className="num">{num(b.numbers.bookings_count) ?? <span className="text-muted">–</span>}</td>
                        <td className="num">{t?.open ? <>{t.open}{t.overdue ? <span className="text-critical-ink"> ({t.overdue} באיחור)</span> : null}</> : '0'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {d.branches.length > 1 && (
                  <tfoot><tr className="border-t border-line-strong font-semibold text-ink">
                    <td>סה״כ</td>
                    <td className="num"><Money value={d.total.today_ex} /></td>
                    <td className="num"><Money value={d.total.month_ex} /></td>
                    <td className="num"><Money value={d.total.last_month_ex} /></td>
                    <td className="num">{num(d.total.tx) ?? '–'}</td>
                    <td className="num">{num(d.total.bookings_count) ?? '–'}</td>
                    <td />
                  </tr></tfoot>
                )}
              </table>
            </div>
          )}
          <p className="mt-4 text-xs text-muted"><VatNote rate={d.vat_rate} inclVat={true} />. סכום ריק = אין נתונים עדיין, לא אפס.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{mine ? 'החלק שלי בהכנסה לפי חודש' : 'הכנסה לפי חודש, כל הסניפים'}</CardTitle>
          <span className="text-sm text-muted">לפני מע״מ · 12 חודשים</span>
        </CardHeader>
        <CardContent>
          {chart.length >= 2 ? <MonthlyBars data={chart} caption="הכנסה חודשית לפני מע״מ של כל הסניפים, 12 החודשים האחרונים" /> : (
            <p className="text-sm text-muted">אין נתונים עדיין</p>
          )}
          {asOf && <p className="mt-3 text-xs text-muted">נתונים מקומיים מהסנכרון האחרון: {stamp(asOf)}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>רווח</CardTitle><Badge>אין נתונים עדיין</Badge></CardHeader>
        <CardContent className="text-sm text-muted">Buyz מדווח הכנסות בלבד, בלי הוצאות, ולכן אין כאן רווח.</CardContent>
      </Card>
    </div>
  );
}
