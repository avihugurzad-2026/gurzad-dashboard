import Link from 'next/link';
import { AlertTriangle, CheckCircle2, CircleDot, Clock, HandCoins } from 'lucide-react';
import type { finance } from '@/server/data';
import { RECEIVABLE_FILTERS, type receivables, type ReceivableFilter } from '@/server/finance';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type Tone } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';
import { NotReady } from '@/components/work/not-ready';
import { AddReceivableDialog, PaymentDialog } from './receivable-forms';
import { RemoveButton } from './remove-button';
import { shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';

type Data = Awaited<ReturnType<typeof receivables>>;
type Vault = Awaited<ReturnType<typeof finance>>;

const STATUS: Record<string, { label: string; tone: Tone; icon: React.ReactNode }> = {
  overdue: { label: 'באיחור', tone: 'critical', icon: <AlertTriangle className="size-3.5" aria-hidden /> },
  partial: { label: 'שולם חלקית', tone: 'warning', icon: <CircleDot className="size-3.5" aria-hidden /> },
  pending: { label: 'ממתין', tone: 'neutral', icon: <Clock className="size-3.5" aria-hidden /> },
  paid: { label: 'שולם', tone: 'good', icon: <CheckCircle2 className="size-3.5" aria-hidden /> },
};

const th = 'py-2 text-start font-medium whitespace-nowrap';

// Collections: dashboard receivables (editable) and, below, open vault debts (read-only)
export function ReceivablesTable({ d, vault, base, place, filterParam = 'rf', extraQuery = '' }: {
  d: Data; vault?: Vault | null; base: string; place: string; filterParam?: string; extraQuery?: string;
}) {
  const href = (f: ReceivableFilter) => {
    const qs = [extraQuery, f === 'all' ? '' : `${filterParam}=${f}`].filter(Boolean).join('&');
    return qs ? `${base}?${qs}` : base;
  };
  const path = base;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-wrap">
          <div>
            <CardTitle>גבייה</CardTitle>
            <p className="text-sm text-muted">
              {d.open_total !== null ? <>פתוח לגבייה <Money value={d.open_total} className="font-medium text-ink" /> כולל מע״מ</> : 'אין חובות פתוחים'}
              {d.overdue_total !== null && <> · באיחור <Money value={d.overdue_total} className="font-medium text-critical-ink" /></>}
            </p>
          </div>
          {d.ready && <AddReceivableDialog path={path} place={place} today={d.today} />}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!d.ready ? <NotReady what="חובות לגבייה" /> : (
            <>
              <nav aria-label="סינון גבייה" className="relative -mx-1 overflow-x-auto px-1">
                <ul className="flex min-w-max gap-1.5">
                  {RECEIVABLE_FILTERS.map(f => {
                    const on = d.filter === f.key;
                    return (
                      <li key={f.key}>
                        <Link href={href(f.key)} aria-current={on ? 'true' : undefined}
                          className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm',
                            on ? 'border-accent bg-accent-soft font-medium text-accent-ink' : 'border-line-strong text-ink-2 hover:text-ink')}>
                          {f.label}<span className="text-xs text-muted tabular">{d.counts[f.key]}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              {d.items.length === 0 ? (
                <Empty icon={<HandCoins className="size-6" />} title={d.counts.all === 0 ? 'עוד אין חובות לגבייה' : 'אין חובות בסינון הזה'}>
                  {d.counts.all === 0 ? 'הוסף חוב עם "+ חוב", ותשלומים יירשמו מכאן.' : 'בחר סינון אחר.'}
                </Empty>
              ) : (
                <div className="relative -mx-5 overflow-x-auto px-5">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="text-xs text-muted">
                      <tr className="border-b border-line">
                        <th scope="col" className={th}>לקוח</th>
                        <th scope="col" className={th}>סכום</th>
                        <th scope="col" className={th}>שולם</th>
                        <th scope="col" className={th}>לתשלום עד</th>
                        <th scope="col" className={th}>ימי איחור</th>
                        <th scope="col" className={th}>סטטוס</th>
                        <th scope="col"><span className="sr-only">פעולות</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map(r => {
                        const s = STATUS[r.status];
                        return (
                          <tr key={r.id} className="border-b border-line last:border-0">
                            <th scope="row" className="py-2.5 text-start font-normal">
                              <bdi className="font-medium">{r.client_name}</bdi>
                              {(r.invoice_number || r.note) && (
                                <span className="block text-xs text-muted">
                                  {r.invoice_number && <>חשבונית <bdi dir="ltr">{r.invoice_number}</bdi></>}
                                  {r.invoice_number && r.note && ' · '}
                                  {r.note && <bdi>{r.note}</bdi>}
                                </span>
                              )}
                            </th>
                            <td className="py-2.5"><Money value={r.amount} /></td>
                            <td className="py-2.5">{r.amount_paid > 0 ? <Money value={r.amount_paid} /> : <span className="text-muted">—</span>}</td>
                            <td className="py-2.5 whitespace-nowrap text-ink-2">{shortDate(r.due_date)}</td>
                            <td className="py-2.5 tabular">{r.days_overdue !== null ? <bdi>{r.days_overdue}</bdi> : <span className="text-muted">—</span>}</td>
                            <td className="py-2.5"><Badge tone={s.tone}>{s.icon}{s.label}</Badge></td>
                            <td className="py-2.5">
                              <div className="flex items-center justify-end gap-1">
                                {r.status !== 'paid' && r.can_edit && (
                                  <PaymentDialog id={r.id} client={r.client_name} remaining={r.remaining} path={path} today={d.today} />
                                )}
                                {r.can_delete && <RemoveButton kind="receivable" id={r.id} path={path} label="מחק חוב" />}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {vault && <VaultDebts d={vault} />}
    </div>
  );
}

function VaultDebts({ d }: { d: Vault }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>מהוואלט (לעדכון באובסידיאן)</CardTitle>
          <p className="text-sm text-muted">יתרות פתוחות שמגיעות מהסנכרון. קריאה בלבד: עדכון נעשה בוואלט.</p>
        </div>
        {d.debt_total !== null && <Money value={d.debt_total} className="font-medium" />}
      </CardHeader>
      <CardContent>
        {d.debts.length === 0 ? <p className="text-sm text-muted">אין יתרות פתוחות בוואלט</p> : (
          <div className="relative -mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-md text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className={th}>לקוח</th>
                  <th scope="col" className={th}>יתרה כולל מע״מ</th>
                  <th scope="col" className={th}>לתשלום עד</th>
                  <th scope="col" className={th}>ימי איחור</th>
                </tr>
              </thead>
              <tbody>
                {d.debts.map(x => (
                  <tr key={x.id} className="border-b border-line last:border-0">
                    <td className="py-2.5"><bdi className="font-medium">{x.client ?? '—'}</bdi></td>
                    <td className="py-2.5"><Money value={x.amount} /></td>
                    <td className="py-2.5 text-ink-2">{x.due_date ? shortDate(x.due_date) : 'אין תאריך'}</td>
                    <td className="py-2.5">
                      {x.days_overdue === null ? <span className="text-muted">—</span>
                        : x.days_overdue > 0 ? <Badge tone="critical"><AlertTriangle className="size-3.5" aria-hidden /><bdi>{x.days_overdue}</bdi> ימים</Badge>
                        : <Badge tone="good"><CheckCircle2 className="size-3.5" aria-hidden />בזמן</Badge>}
                    </td>
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
