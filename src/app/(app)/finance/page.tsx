import Link from 'next/link';
import { HandCoins, TrendingUp } from 'lucide-react';
import { finance, resolveWorkspace, workspaces } from '@/server/data';
import { ils, shortDate } from '@/lib/format';
import { Filters } from '@/components/shell/filters';
import { KpiCard } from '@/components/dash/kpi-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';

export const metadata = { title: 'הכנסות וגבייה — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [ws, branch] = await Promise.all([workspaces(), resolveWorkspace(sp.w)]);
  const d = await finance(branch);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold">הכנסות וגבייה</h1>
          <p className="text-sm text-muted">הכנסה ללא מע״מ. יתרות לגבייה כולל מע״מ.</p>
        </div>
        <Filters workspaces={ws} workspace={branch} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="הכנסה חודשית קבועה" icon={<TrendingUp className="size-4" />} value={ils(d.mrr)}
          hint={d.mrr_gross !== null ? `${ils(d.mrr_gross)} כולל מע״מ` : undefined} reason="אין ריטיינרים פעילים" />
        <KpiCard label="כסף שמחכה לגבייה" icon={<HandCoins className="size-4" />} value={ils(d.debt_total)}
          hint={`${d.debts.length} יתרות`} reason="אין יתרות פתוחות" />
        <KpiCard label="ריכוז לקוחות" amount={false}
          value={d.concentration ? `${d.concentration.max_pct}%` : null}
          hint={d.concentration ? `הלקוח הגדול מתוך ${d.concentration.total_clients}` : undefined}
          reason="אין ריטיינרים פעילים" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ריטיינרים</CardTitle>
          <span className="text-sm text-muted">{d.retainers.length} פעילים</span>
        </CardHeader>
        <CardContent>
          {d.retainers.length === 0 ? (
            <Empty title="אין ריטיינרים פעילים">ריטיינרים מגיעים מהוואלט בסנכרון.</Empty>
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-md text-sm">
                <thead className="text-start text-xs text-muted">
                  <tr className="border-b border-line">
                    <th scope="col" className="py-2 text-start font-medium">לקוח</th>
                    <th scope="col" className="py-2 text-start font-medium">חודשי ללא מע״מ</th>
                    <th scope="col" className="py-2 text-start font-medium">סוף חוזה</th>
                    <th scope="col" className="py-2 text-start font-medium">מועד הודעה</th>
                  </tr>
                </thead>
                <tbody>
                  {d.retainers.map(r => (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="py-2.5"><bdi className="font-medium">{r.client ?? '—'}</bdi></td>
                      <td className="py-2.5"><Money value={r.fee_net} /></td>
                      <td className="py-2.5 text-muted">{r.contract_end ? shortDate(r.contract_end) : '—'}</td>
                      <td className="py-2.5 text-muted">{r.notice_deadline ? shortDate(r.notice_deadline) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>גבייה</CardTitle>
          <span className="text-sm text-muted">{d.aging ? 'לפי גיל' : `${d.debts.filter(x => !x.due_date).length} בלי תאריך`}</span>
        </CardHeader>
        <CardContent>
          {d.debts.length === 0 ? (
            <Empty title="אין יתרות פתוחות">כל היתרות סומנו כשולמו.</Empty>
          ) : (
            <>
              {!d.aging && (
                <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-ink">
                  אין תאריך לתשלום באף יתרה, ולכן אין גיול חובות.{' '}
                  <Link href="/health" className="font-medium underline">מה חסר</Link>
                </p>
              )}
              <div className="-mx-5 overflow-x-auto px-5">
                <table className="w-full min-w-md text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="border-b border-line">
                      <th scope="col" className="py-2 text-start font-medium">לקוח</th>
                      <th scope="col" className="py-2 text-start font-medium">יתרה כולל מע״מ</th>
                      <th scope="col" className="py-2 text-start font-medium">לתשלום עד</th>
                      <th scope="col" className="py-2 text-start font-medium">איחור</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.debts.map(x => (
                      <tr key={x.id} className="border-b border-line last:border-0">
                        <td className="py-2.5"><bdi className="font-medium">{x.client ?? '—'}</bdi></td>
                        <td className="py-2.5"><Money value={x.amount} /></td>
                        <td className="py-2.5 text-muted">{x.due_date ? shortDate(x.due_date) : 'אין תאריך'}</td>
                        <td className="py-2.5">
                          {x.days_overdue === null ? <span className="text-muted">—</span>
                            : x.days_overdue > 0 ? <Badge tone="critical">{x.days_overdue} ימים</Badge>
                            : <Badge tone="good">בזמן</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
