import Link from 'next/link';
import { FileText, ListChecks, Receipt, Users } from 'lucide-react';
import type { Contact, DocumentRef, SubjectTx, ValueSource } from '@/server/ventures';
import { VALUE_SOURCE_LABEL } from '@/server/ventures';
import type { WorkItem } from '@/server/entries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { TaskRow } from '@/components/work/task-row';
import { RemoveButton } from '@/components/finance/remove-button';
import { NO_DATA, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ContactDialog, SubjectTaskForm, SubjectTxDialog } from './forms';
import { VentureRemove } from './buttons';

const pctFmt = new Intl.NumberFormat('he-IL', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 2 });

// A ratio (0.036) as "3.6%"; null → "אין נתונים עדיין"
export function Pct({ value, className, empty = NO_DATA }: { value: number | null | undefined; className?: string; empty?: string }) {
  if (value === null || value === undefined || Number.isNaN(value)) return <span className={cn('text-muted', className)}>{empty}</span>;
  return <bdi className={cn('tabular', value < 0 && 'text-critical-ink', className)}>{pctFmt.format(value)}</bdi>;
}
export const pctText = (v: number | null | undefined) => (v === null || v === undefined ? null : pctFmt.format(v));

// "הערכה · 1 באוק׳" next to a value that is not a fact
export function ValueNote({ source, date }: { source: ValueSource | null; date: string | null }) {
  if (!source) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs text-muted">
      <Badge tone={source === 'estimate' ? 'warning' : 'neutral'}>{VALUE_SOURCE_LABEL[source]}</Badge>
      {date && <span>נכון ל-<bdi>{shortDate(date)}</bdi></span>}
    </span>
  );
}

// Label / value pairs
export function Facts({ items }: { items: { label: string; value: React.ReactNode; hint?: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(i => (
        <div key={i.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted">{i.label}</dt>
          <dd className="min-w-0 break-words text-ink">{i.value}</dd>
          {i.hint && <dd className="text-xs text-muted">{i.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
export const textOr = (v: string | null | undefined) => (v ? <bdi>{v}</bdi> : <span className="text-muted">{NO_DATA}</span>);

const th = 'py-2 text-start font-medium whitespace-nowrap';

export function SubjectMoney({ title, items, path, add, note }: {
  title: string; items: SubjectTx[]; path: string; note?: string;
  add?: { subjectType: 'asset' | 'investment' | 'legal_case'; subjectId: string; today: string; label?: string; defaultDirection?: 'income' | 'expense' } | null;
}) {
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>{title}</CardTitle>
          {note && <p className="text-sm text-muted">{note}</p>}
        </div>
        {add && <SubjectTxDialog subjectType={add.subjectType} subjectId={add.subjectId} path={path} today={add.today} label={add.label} defaultDirection={add.defaultDirection} />}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted"><Receipt className="size-4" aria-hidden />אין תנועות עדיין</p>
        ) : (
          <div className="relative -mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className={th}>תאריך</th><th scope="col" className={th}>סוג</th>
                  <th scope="col" className={th}>תיאור</th><th scope="col" className={th}>סכום (ללא מע״מ)</th>
                  <th scope="col" className={th}><span className="sr-only">פעולות</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map(t => (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="py-2 whitespace-nowrap"><bdi>{shortDate(t.occurred_on)}</bdi></td>
                    <td className="py-2"><Badge tone={t.direction === 'income' ? 'good' : 'neutral'}>{t.direction === 'income' ? 'הכנסה' : 'הוצאה'}</Badge> <span className="text-xs text-muted">{t.category_label}</span></td>
                    <td className="py-2 max-w-64 truncate"><bdi>{t.description ?? t.counterparty_name ?? ''}</bdi></td>
                    <td className={cn('py-2 whitespace-nowrap', t.direction === 'expense' && 'text-ink-2')}>
                      {t.direction === 'expense' ? '−' : ''}<Money value={t.amount_net} />
                    </td>
                    <td className="py-2 text-end">
                      {t.can_delete && <RemoveButton kind="transaction" id={t.id} path={path} label="מחק תנועה" />}
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

export function SubjectTasks({ items, subjectType, subjectId, path, canAdd }: {
  items: WorkItem[]; subjectType: string; subjectId: string; path: string; canAdd: boolean;
}) {
  return (
    <Card>
      <CardHeader><CardTitle>משימות קשורות</CardTitle><span className="text-sm text-muted">{items.filter(t => t.status !== 'done' && t.status !== 'cancelled').length} פתוחות</span></CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted"><ListChecks className="size-4" aria-hidden />אין משימות עדיין</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {items.map(t => <TaskRow key={t.id} item={t} path={path} showContext={false} />)}
          </ul>
        )}
        {canAdd && <SubjectTaskForm subjectType={subjectType} subjectId={subjectId} path={path} />}
      </CardContent>
    </Card>
  );
}

export function SubjectContacts({ items, subjectType, subjectId, path, canAdd }: {
  items: Contact[]; subjectType: string; subjectId: string; path: string; canAdd: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <CardTitle>אנשי קשר</CardTitle>
        {canAdd && <ContactDialog subjectType={subjectType} subjectId={subjectId} path={path} />}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted"><Users className="size-4" aria-hidden />אין אנשי קשר עדיין</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--border)] text-sm">
            {items.map(c => (
              <li key={c.link_id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium"><bdi>{c.name}</bdi>{c.role && <span className="ms-2 text-xs font-normal text-muted"><bdi>{c.role}</bdi></span>}</p>
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                    {c.phone && <a href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`} dir="ltr" className="hover:text-ink">{c.phone}</a>}
                    {c.email && <a href={`mailto:${c.email}`} dir="ltr" className="break-all hover:text-ink">{c.email}</a>}
                    {c.notes && <bdi>{c.notes}</bdi>}
                  </p>
                </div>
                {canAdd && <VentureRemove kind="contact" id={c.link_id} path={path} label="הסר את איש הקשר מכאן" />}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const DOC_TYPE: Record<string, string> = { invoice: 'חשבונית', receipt: 'קבלה', contract: 'חוזה', legal: 'משפטי', report: 'דוח', other: 'מסמך' };

// Documents and contracts come from the documents work (3.4); here they are only listed
export function SubjectDocuments({ docs }: { docs: { ready: boolean; items: DocumentRef[] } }) {
  return (
    <Card>
      <CardHeader><CardTitle>מסמכים וחוזים</CardTitle>{docs.ready && <Link href="/documents" className="text-sm text-accent hover:underline">כל המסמכים</Link>}</CardHeader>
      <CardContent>
        {docs.items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted"><FileText className="size-4" aria-hidden />אין מסמכים עדיין</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--border)] text-sm">
            {docs.items.map(d => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                {d.file_id
                  ? <a href={`/api/v1/files/${d.file_id}`} className="min-w-0 truncate hover:underline"><bdi>{d.title}</bdi></a>
                  : <span className="min-w-0 truncate"><bdi>{d.title}</bdi></span>}
                <span className="shrink-0 text-xs text-muted">{DOC_TYPE[d.doc_type] ?? d.doc_type}{d.doc_date ? ` · ${shortDate(d.doc_date)}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
