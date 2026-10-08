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
          <div className="relative overflow-x-auto">
            <table className="data-table min-w-md">
              <thead>
                <tr>
                  <th scope="col">לקוח</th>
                  <th scope="col" className="num">חודשי ללא מע״מ</th>
                  <th scope="col">סוף חוזה</th>
                  <th scope="col">מועד הודעה</th>
                </tr>
              </thead>
              <tbody>
                {d.retainers.map(r => (
                  <tr key={r.id}>
                    <td><bdi className="font-medium">{r.client ?? '—'}</bdi></td>
                    <td className="num"><Money value={r.fee_net} /></td>
                    <td className="text-muted">{r.contract_end ? shortDate(r.contract_end) : '—'}</td>
                    <td className="text-muted">{r.notice_deadline ? shortDate(r.notice_deadline) : '—'}</td>
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
              <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning-ink">
                אין תאריך לתשלום באף יתרה, ולכן אין גיול חובות.{' '}
                <Link href="/health" className="font-medium underline">מה חסר</Link>
              </p>
            )}
            <div className="relative overflow-x-auto">
              <table className="data-table min-w-md">
                <thead>
                  <tr>
                    <th scope="col">לקוח</th>
                    <th scope="col" className="num">יתרה כולל מע״מ</th>
                    <th scope="col">לתשלום עד</th>
                    <th scope="col">איחור</th>
                  </tr>
                </thead>
                <tbody>
                  {d.debts.map(x => (
                    <tr key={x.id}>
                      <td><bdi className="font-medium">{x.client ?? '—'}</bdi></td>
                      <td className="num"><Money value={x.amount} /></td>
                      <td className="text-muted">{x.due_date ? shortDate(x.due_date) : 'אין תאריך'}</td>
                      <td>
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
