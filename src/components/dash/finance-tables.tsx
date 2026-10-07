import Link from 'next/link';
import type { finance } from '@/server/data';
import { shortDate } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';

// a-digital clients (retainers) and collections (open balances). Both come from the vault, read-only.
type Finance = Awaited<ReturnType<typeof finance>>;

export function RetainersTable({ d }: { d: Finance }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>לקוחות וריטיינרים</CardTitle>
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
  );
}

export function DebtsTable({ d }: { d: Finance }) {
  return (
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
  );
}
