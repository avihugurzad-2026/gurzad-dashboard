import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, CalendarClock } from 'lucide-react';
import { canCreateIn, requirePlace } from '@/server/auth';
import { CASE_STATUSES, caseDetail, labelIn } from '@/server/ventures';
import { shortDate } from '@/lib/format';
import { KpiCard } from '@/components/dash/kpi-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type Tone } from '@/components/ui/badge';
import { AddDeadlineForm, EditCaseDialog } from '@/components/ventures/forms';
import { DeadlineToggle, VentureRemove } from '@/components/ventures/buttons';
import { Facts, SubjectContacts, SubjectDocuments, SubjectMoney, SubjectTasks, textOr } from '@/components/ventures/sections';
import { ils } from '@/lib/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'תיק משפטי — דשבורד גורזד' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_TONE: Record<string, Tone> = { open: 'accent', waiting: 'warning', closed: 'neutral' };
const full = (iso: string | null) => (iso ? `${shortDate(iso)} ${iso.slice(0, 4)}` : null);

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePlace({ domain: 'ventures', branch: 'legal-and-tasks' }, 'task');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const d = await caseDetail(u, id);
  if (!d) notFound();
  const c = d.legalCase;
  const path = `/ventures/legal-and-tasks/${id}`;
  const canTask = canCreateIn(u, { domain: 'ventures', branch: 'legal-and-tasks' }, 'task');
  const open = d.deadlines.filter(x => !x.done_at);
  const done = d.deadlines.filter(x => x.done_at);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link href="/ventures/legal-and-tasks" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowRight className="size-4" aria-hidden />משפטי</Link>
          <h1 className="flex flex-wrap items-center gap-2 text-page font-bold"><bdi>{c.title}</bdi><Badge tone={STATUS_TONE[c.status]}>{labelIn(CASE_STATUSES, c.status)}</Badge></h1>
          {c.case_number && <p className="text-sm text-muted">תיק <bdi dir="ltr">{c.case_number}</bdi>{c.court ? <> · <bdi>{c.court}</bdi></> : null}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d.can_edit && <EditCaseDialog values={c} path={path} today={d.today} />}
          {d.can_delete && <VentureRemove kind="case" id={c.id} path="/ventures/legal-and-tasks" after="/ventures/legal-and-tasks" label="למחוק את התיק" text="מחק" />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="המועד הבא" amount={false}
          value={c.next_deadline ? `${shortDate(c.next_deadline.due_on)} · ${c.next_deadline.title}` : null} reason="אין מועדים פתוחים"
          hint={c.next_deadline?.state === 'overdue' ? 'המועד עבר' : undefined} />
        <KpiCard label="מועדים שעברו" amount={false} value={open.length ? String(c.overdue_count) : null} reason="אין מועדים פתוחים" />
        <KpiCard label="שולם בתיק" value={ils(c.paid_total)} reason="לא נרשמו תשלומים" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>פרטי התיק</CardTitle></CardHeader>
          <CardContent>
            <Facts items={[
              { label: 'צדדים', value: textOr(c.parties) },
              { label: 'עורך/ת דין', value: textOr(c.lawyer) },
              { label: 'ערכאה', value: textOr(c.court) },
              { label: 'נפתח', value: textOr(full(c.opened_on)) },
              ...(c.closed_on ? [{ label: 'נסגר', value: textOr(full(c.closed_on)) }] : []),
            ]} />
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-xs text-muted">הערות</p>
              {c.notes ? <p className="mt-1 whitespace-pre-wrap text-sm"><bdi>{c.notes}</bdi></p> : <p className="mt-1 text-sm text-muted">אין הערות עדיין</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>מועדים (Deadlines)</CardTitle><span className="text-sm text-muted">{open.length} פתוחים</span></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {d.deadlines.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted"><CalendarClock className="size-4" aria-hidden />אין מועדים עדיין</p>
            ) : (
              <ul className="flex flex-col divide-y divide-[color:var(--border)]">
                {[...open, ...done].map(x => (
                  <li key={x.id} className={cn('flex items-start gap-3 py-2', x.state === 'overdue' && 'rounded-md bg-critical-soft px-2')}>
                    {d.can_edit ? <DeadlineToggle id={x.id} done={Boolean(x.done_at)} path={path} /> : null}
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm', x.done_at && 'text-muted line-through')}><bdi>{x.title}</bdi></p>
                      <p className={cn('text-xs', x.state === 'overdue' ? 'font-medium text-critical-ink' : x.state === 'soon' ? 'text-warning-ink' : 'text-muted')}>
                        <bdi>{full(x.due_on)}</bdi>{x.state === 'overdue' ? ' · עבר' : x.state === 'soon' ? ' · השבוע' : ''}
                      </p>
                    </div>
                    {d.can_edit && <VentureRemove kind="deadline" id={x.id} path={path} label="למחוק את המועד" />}
                  </li>
                ))}
              </ul>
            )}
            {d.can_edit && <AddDeadlineForm caseId={c.id} path={path} />}
          </CardContent>
        </Card>
      </div>

      <SubjectMoney title="תשלומים" items={d.transactions} path={path} note="שכר טרחה, אגרות והוצאות התיק (ללא מע״מ)"
        add={d.can_edit && d.can_pay ? { subjectType: 'legal_case', subjectId: c.id, today: d.today, label: 'תשלום', defaultDirection: 'expense' } : null} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <SubjectTasks items={d.tasks} subjectType="legal_case" subjectId={c.id} path={path} canAdd={canTask && d.can_edit} />
        <SubjectContacts items={d.contacts} subjectType="legal_case" subjectId={c.id} path={path} canAdd={d.can_edit} />
      </div>
      <SubjectDocuments docs={d.documents} />
    </div>
  );
}
