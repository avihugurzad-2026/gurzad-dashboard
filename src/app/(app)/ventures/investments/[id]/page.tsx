import { notFound } from 'next/navigation';
import { canCreateIn, requirePlace } from '@/server/auth';
import { investmentDetail } from '@/server/ventures';
import { todayIL } from '@/lib/period';
import { ils, shortDate } from '@/lib/format';
import { KpiCard } from '@/components/dash/kpi-card';
import { Card, CardContent, Section } from '@/components/ui/card';
import { PageHeader } from '@/components/shell/page-header';
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
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader title={i.name} crumb={i.name}
        subtitle={<>{i.category_label}{i.ticker ? <> · <bdi dir="ltr">{i.ticker}</bdi></> : null}</>}
        status={i.status === 'exited' ? <Badge>מומשה</Badge> : undefined}
        actions={(d.can_edit || d.can_delete) ? <>
          {d.can_edit && <UpdateInvestmentDialog inv={i} path={path} today={today} />}
          {d.can_delete && <VentureRemove kind="investment" id={i.id} path="/ventures/investments" after="/ventures/investments" label="למחוק את ההשקעה" text="מחק" />}
        </> : undefined} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="סכום ההשקעה" value={ils(i.amount_invested)} hint={`מ-${shortDate(i.invested_on)} ${i.invested_on.slice(0, 4)}`} />
        <KpiCard label="שווי נוכחי" value={ils(i.current_value)} reason="לא הוזן שווי"
          foot={i.value_source ? <ValueNote source={i.value_source} date={i.value_date} /> : undefined} />
        <KpiCard label="רווח / הפסד" value={ils(i.gain)} hint={pctText(i.pct) ?? undefined} reason="צריך שווי נוכחי" />
        <KpiCard label="תשואה שנתית" value={pctText(i.annualized)} reason={i.current_value === null ? 'צריך שווי נוכחי' : 'מחושבת אחרי שנה לפחות'} amount={false} />
      </div>

      <Section title="פרטים">
      <Card>
        <CardContent className="pt-5 sm:pt-6">
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
      </Section>

      <SubjectMoney title="תנועות כסף" items={d.transactions} path={path} note="הפקדות, משיכות, דמי ניהול ודיבידנדים"
        add={d.can_edit ? { subjectType: 'investment', subjectId: i.id, today, label: 'תנועה', defaultDirection: 'expense' } : null} />

      <div className="grid grid-cols-1 gap-x-4 gap-y-8 xl:grid-cols-2 [&>*]:min-w-0">
        <SubjectTasks items={d.tasks} subjectType="investment" subjectId={i.id} path={path} canAdd={canTask && d.can_edit} />
        <SubjectContacts items={d.contacts} subjectType="investment" subjectId={i.id} path={path} canAdd={d.can_edit} />
      </div>
      <SubjectDocuments docs={d.documents} />
    </div>
  );
}
