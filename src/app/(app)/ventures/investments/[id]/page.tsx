import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { canCreateIn, requirePlace } from '@/server/auth';
import { investmentDetail } from '@/server/ventures';
import { todayIL } from '@/lib/period';
import { ils, shortDate } from '@/lib/format';
import { KpiCard } from '@/components/dash/kpi-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { UpdateInvestmentDialog } from '@/components/ventures/forms';
import { VentureRemove } from '@/components/ventures/buttons';
import { Facts, Pct, SubjectContacts, SubjectDocuments, SubjectMoney, SubjectTasks, ValueNote, pctText, textOr } from '@/components/ventures/sections';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'השקעה — דשבורד גורזד' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InvestmentPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePlace({ domain: 'ventures', branch: 'investments' }, 'money');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const d = await investmentDetail(u, id);
  if (!d) notFound();
  const i = d.investment;
  const today = todayIL();
  const path = `/ventures/investments/${id}`;
  const canTask = canCreateIn(u, { domain: 'ventures', branch: 'investments' }, 'task');

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link href="/ventures/investments" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowRight className="size-4" aria-hidden />השקעות</Link>
          <h1 className="flex flex-wrap items-center gap-2 text-page font-bold"><bdi>{i.name}</bdi>{i.status === 'exited' && <Badge>מומשה</Badge>}</h1>
          <p className="text-sm text-muted">{i.category_label}{i.ticker ? <> · <bdi dir="ltr">{i.ticker}</bdi></> : null}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d.can_edit && <UpdateInvestmentDialog inv={i} path={path} today={today} />}
          {d.can_delete && <VentureRemove kind="investment" id={i.id} path="/ventures/investments" after="/ventures/investments" label="למחוק את ההשקעה" text="מחק" />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="סכום ההשקעה" value={ils(i.amount_invested)} hint={`מ-${shortDate(i.invested_on)} ${i.invested_on.slice(0, 4)}`} />
        <KpiCard label="שווי נוכחי" value={ils(i.current_value)} reason="לא הוזן שווי"
          foot={i.value_source ? <ValueNote source={i.value_source} date={i.value_date} /> : undefined} />
        <KpiCard label="רווח / הפסד" value={ils(i.gain)} hint={pctText(i.pct) ?? undefined} reason="צריך שווי נוכחי" />
        <KpiCard label="תשואה שנתית" value={pctText(i.annualized)} reason={i.current_value === null ? 'צריך שווי נוכחי' : 'מחושבת אחרי שנה לפחות'} amount={false} />
      </div>

      <Card>
        <CardHeader><CardTitle>פרטים</CardTitle></CardHeader>
        <CardContent>
          <Facts items={[
            { label: 'קטגוריה', value: i.category_label },
            { label: 'תאריך ההשקעה', value: <bdi>{shortDate(i.invested_on)} {i.invested_on.slice(0, 4)}</bdi> },
            { label: 'שווי', value: <><Money value={i.current_value} /> <ValueNote source={i.value_source} date={i.value_date} /></> },
            { label: 'תשואה', value: <Pct value={i.pct} /> },
            { label: 'סימול', value: i.ticker ? <bdi dir="ltr">{i.ticker}</bdi> : textOr(null), hint: 'לחיבור עתידי לנתוני שוק' },
            { label: 'הערות', value: textOr(i.notes) },
          ]} />
        </CardContent>
      </Card>

      <SubjectMoney title="תנועות כסף" items={d.transactions} path={path} note="הפקדות, משיכות, דמי ניהול ודיבידנדים"
        add={d.can_edit ? { subjectType: 'investment', subjectId: i.id, today, label: 'תנועה', defaultDirection: 'expense' } : null} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <SubjectTasks items={d.tasks} subjectType="investment" subjectId={i.id} path={path} canAdd={canTask && d.can_edit} />
        <SubjectContacts items={d.contacts} subjectType="investment" subjectId={i.id} path={path} canAdd={d.can_edit} />
      </div>
      <SubjectDocuments docs={d.documents} />
    </div>
  );
}
