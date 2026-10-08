import Link from 'next/link';
import { FileText, ListChecks, Receipt, Users } from 'lucide-react';
import type { Contact, DocumentRef, SubjectTx, ValueSource } from '@/server/ventures';
import { VALUE_SOURCE_LABEL } from '@/server/ventures';
import type { WorkItem } from '@/server/entries';
import { Card, CardContent, Section } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { buttonClass } from '@/components/ui/button';
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
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
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

// Row headers in .data-table: normal weight, wrap, same hover/last-row behaviour as the td cells
export const rowTh = 'whitespace-normal font-normal text-ink [tr:last-child>&]:border-b-0 [tr:hover>&]:bg-surface-2';

// The detail pages are built from titled sections; `fill` stretches the card when the section sits in a grid
export function SubjectMoney({ title, items, path, add, note }: {
  title: string; items: SubjectTx[]; path: string; note?: string;
  add?: { subjectType: 'asset' | 'investment' | 'legal_case'; subjectId: string; today: string; label?: string; defaultDirection?: 'income' | 'expense' } | null;
}) {
  return (
    <Section title={title}
      action={add ? <SubjectTxDialog subjectType={add.subjectType} subjectId={add.subjectId} path={path} today={add.today} label={add.label} defaultDirection={add.defaultDirection} /> : undefined}>
      <Card>
        <CardContent className="pt-5 sm:pt-6">
          {note && <p className="mb-4 text-sm text-muted">{note}</p>}
          {items.length === 0 ? (
            <Empty compact icon={<Receipt />} title="אין תנועות עדיין" />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="data-table min-w-[560px]">
                <thead>
                  <tr>
                    <th scope="col">תאריך</th><th scope="col">סוג</th>
                    <th scope="col">תיאור</th><th scope="col" className="num">סכום (ללא מע״מ)</th>
                    <th scope="col"><span className="sr-only">פעולות</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(t => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap text-muted"><bdi>{shortDate(t.occurred_on)}</bdi></td>
                      <td>
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={t.direction === 'income' ? 'good' : 'neutral'}>{t.direction === 'income' ? 'הכנסה' : 'הוצאה'}</Badge>
                          <span className="text-xs text-muted">{t.category_label}</span>
                        </span>
                      </td>
                      <td className="max-w-64 truncate"><bdi>{t.description ?? t.counterparty_name ?? ''}</bdi></td>
                      <td className={cn('num font-medium', t.direction === 'income' ? 'text-good-ink' : 'text-ink')}>
                        {t.direction === 'expense' ? '−' : ''}<Money value={t.amount_net} />
                      </td>
                      <td className="w-10 text-end">
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
    </Section>
  );
}

export function SubjectTasks({ items, subjectType, subjectId, path, canAdd }: {
  items: WorkItem[]; subjectType: string; subjectId: string; path: string; canAdd: boolean;
}) {
  const open = items.filter(t => t.status !== 'done' && t.status !== 'cancelled').length;
  return (
    <Section title="משימות קשורות" action={<span className="text-sm text-muted">{open} פתוחות</span>}>
      <Card className="flex-1">
        <CardContent className="flex flex-col gap-4 pt-5 sm:pt-6">
          {items.length === 0 ? (
            <Empty compact icon={<ListChecks />} title="אין משימות עדיין" />
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {items.map(t => <TaskRow key={t.id} item={t} path={path} showContext={false} />)}
            </ul>
          )}
          {canAdd && <div className="border-t border-line pt-4"><SubjectTaskForm subjectType={subjectType} subjectId={subjectId} path={path} /></div>}
        </CardContent>
      </Card>
    </Section>
  );
}

export function SubjectContacts({ items, subjectType, subjectId, path, canAdd }: {
  items: Contact[]; subjectType: string; subjectId: string; path: string; canAdd: boolean;
}) {
  return (
    <Section title="אנשי קשר" action={canAdd ? <ContactDialog subjectType={subjectType} subjectId={subjectId} path={path} /> : undefined}>
      <Card className="flex-1">
        <CardContent className="pt-5 sm:pt-6">
          {items.length === 0 ? (
            <Empty compact icon={<Users />} title="אין אנשי קשר עדיין" />
          ) : (
            <ul className="flex flex-col divide-y divide-[color:var(--border)] text-sm">
              {items.map(c => (
                <li key={c.link_id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-body font-medium"><bdi>{c.name}</bdi>{c.role && <span className="ms-2 text-xs font-normal text-muted"><bdi>{c.role}</bdi></span>}</p>
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
    </Section>
  );
}

const DOC_TYPE: Record<string, string> = { invoice: 'חשבונית', receipt: 'קבלה', contract: 'חוזה', legal: 'משפטי', report: 'דוח', other: 'מסמך' };

// Documents and contracts come from the documents work (3.4); here they are only listed
export function SubjectDocuments({ docs }: { docs: { ready: boolean; items: DocumentRef[] } }) {
  return (
    <Section title="מסמכים וחוזים" action={docs.ready ? <Link href="/documents" className={buttonClass('ghost', 'sm')}>כל המסמכים</Link> : undefined}>
      <Card>
        <CardContent className="pt-5 sm:pt-6">
          {docs.items.length === 0 ? (
            <Empty compact icon={<FileText />} title="אין מסמכים עדיין" />
          ) : (
            <ul className="flex flex-col divide-y divide-[color:var(--border)] text-sm">
              {docs.items.map(d => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  {d.file_id
                    ? <a href={`/api/v1/files/${d.file_id}`} className="min-w-0 truncate font-medium hover:underline"><bdi>{d.title}</bdi></a>
                    : <span className="min-w-0 truncate font-medium"><bdi>{d.title}</bdi></span>}
                  <span className="shrink-0 text-xs text-muted">{DOC_TYPE[d.doc_type] ?? d.doc_type}{d.doc_date ? <> · <bdi>{shortDate(d.doc_date)}</bdi></> : null}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </Section>
  );
}
