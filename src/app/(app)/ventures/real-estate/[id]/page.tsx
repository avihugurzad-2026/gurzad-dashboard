import { notFound } from 'next/navigation';
import { Landmark } from 'lucide-react';
import { canCreateIn, requirePlace } from '@/server/auth';
import { ASSET_KINDS, labelIn, propertyDetail } from '@/server/ventures';
import { todayIL } from '@/lib/period';
import { ils, shortDate } from '@/lib/format';
import { KpiCard } from '@/components/dash/kpi-card';
import { Card, CardContent, CardHeader, CardTitle, Section } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { AddLoanDialog, PropertyValueDialog, RepaymentDialog } from '@/components/ventures/forms';
import { VentureRemove } from '@/components/ventures/buttons';
import { Facts, Pct, SubjectContacts, SubjectDocuments, SubjectMoney, SubjectTasks, ValueNote, pctText, textOr } from '@/components/ventures/sections';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'נכס — דשבורד גורזד' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ratePct = new Intl.NumberFormat('he-IL', { style: 'percent', maximumFractionDigits: 3 });
const sharePct = (n: number) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 }).format(n) + '%';

// One property: value, cost, its loans (repayments, amortization), money, yields, tasks, contacts, documents
export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePlace({ domain: 'ventures', branch: 'real-estate' }, 'money');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const d = await propertyDetail(u, id);
  if (!d) notFound();
  const p = d.property;
  const y = p.yields;
  const today = todayIL();
  const path = `/ventures/real-estate/${id}`;
  const canTask = canCreateIn(u, { domain: 'ventures', branch: 'real-estate' }, 'task');
  const months = p.months_of_data < 12 ? `מבוסס על ${p.months_of_data} חודשים מאז הרכישה` : '12 החודשים האחרונים';
  const estimate = p.value_source === 'estimate';

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader title={p.name} crumb={p.name}
        subtitle={<>{labelIn(ASSET_KINDS, p.kind)}{p.address ? <> · <bdi>{p.address}</bdi></> : null}</>}
        actions={(d.can_edit || d.can_delete) ? <>
          {d.can_edit && <PropertyValueDialog id={p.id} path={path} today={today} value={p.current_value} source={p.value_source} />}
          {d.can_edit && <AddLoanDialog assetId={p.id} path={path} today={today} />}
          {d.can_delete && <VentureRemove kind="property" id={p.id} path="/ventures/real-estate" after="/ventures/real-estate" label="למחוק את הנכס (וההלוואות שלו)" text="מחק" />}
        </> : undefined} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="שווי נוכחי" value={ils(p.current_value)} reason="לא הוזן שווי"
          foot={p.value_source ? <ValueNote source={p.value_source} date={p.value_date} /> : undefined} />
        <KpiCard label="יתרת הלוואות" value={ils(p.loan_balance)} reason="אין הלוואה על הנכס"
          hint={p.loan_balance !== null && p.loan_balance_venture !== p.loan_balance ? `חלק היזמות ${ils(p.loan_balance_venture)}` : undefined} />
        <KpiCard label="הון בנכס" value={ils(p.equity_value)} reason="צריך שווי נוכחי"
          hint={p.equity_value !== null ? `שווי פחות יתרת ההלוואה${estimate ? ' · לפי הערכה' : ''}` : undefined} />
        <KpiCard label="החזר חודשי" value={ils(p.monthly_payment)} reason="אין הלוואה על הנכס" />
      </div>

      <div className="grid grid-cols-1 gap-x-4 gap-y-8 xl:grid-cols-2 [&>*]:min-w-0">
        <Section title="פרטי הנכס">
        <Card className="flex-1">
          <CardContent className="pt-5 sm:pt-6">
            <Facts items={[
              { label: 'עלות רכישה', value: <Money value={p.purchase_cost} />, hint: 'כולל מס רכישה ועמלות' },
              { label: 'תאריך רכישה', value: p.purchase_date ? <bdi>{shortDate(p.purchase_date)} {p.purchase_date.slice(0, 4)}</bdi> : textOr(null) },
              { label: 'שווי נוכחי', value: <><Money value={p.current_value} /> <ValueNote source={p.value_source} date={p.value_date} /></> },
              { label: 'שינוי מעלות הרכישה', value: p.current_value !== null && p.purchase_cost !== null
                ? <><Money value={p.current_value - p.purchase_cost} />{estimate && <span className="ms-1 text-xs text-warning-ink">(הערכה)</span>}</> : textOr(null) },
              { label: 'הערות', value: textOr(p.notes) },
            ]} />
          </CardContent>
        </Card>
        </Section>
        <Section title="תשואה">
        <Card className="flex-1">
          <CardContent className="flex flex-col gap-4 pt-5 sm:pt-6">
            <p className="text-sm text-muted">{months} · חלק היזמות · ללא מע״מ</p>
            <Facts items={[
              { label: 'תשואה ברוטו', value: <Pct value={y.gross} />, hint: 'הכנסות ÷ עלות רכישה' },
              { label: 'תשואה נטו על ההון', value: <Pct value={y.net} />, hint: 'הכנסות − הוצאות − ריבית, ÷ הון עצמי' },
              { label: 'תזרים על ההון (cash-on-cash)', value: <Pct value={y.cash_on_cash} />, hint: 'אחרי כל ההחזר (ריבית וקרן), ÷ הון עצמי' },
              { label: 'הון עצמי בהשקעה', value: <Money value={y.equity} />, hint: 'עלות רכישה − קרן ההלוואה (חלק היזמות)' },
              { label: 'הכנסות', value: <Money value={p.income_12m} /> },
              { label: 'הוצאות שוטפות', value: <Money value={p.expenses_12m} empty={p.income_12m !== null ? 'אין הוצאות רשומות' : undefined} /> },
              { label: 'ריבית ששולמה', value: <Money value={p.interest_12m} empty={p.loans_count ? 'לא נרשמו החזרים' : 'אין הלוואה'} />,
                hint: p.loans_count ? `לפי ${p.repayments_12m} החזרים שנרשמו` : undefined },
              { label: 'קרן שהוחזרה', value: <Money value={p.principal_12m} empty={p.loans_count ? 'לא נרשמו החזרים' : 'אין הלוואה'} /> },
              { label: 'תזרים נטו', value: <Money value={y.cash_flow} /> },
            ]} />
            {y.gross === null && <p className="text-xs text-muted">התשואה תחושב אחרי שתירשם הכנסה לנכס (&quot;+ הכנסה/הוצאה&quot; למטה).</p>}
          </CardContent>
        </Card>
        </Section>
      </div>

      {/* Loans */}
      <Section title="הלוואות">
      {d.loans.length === 0 ? (
        <Card><Empty compact icon={<Landmark />} title="אין הלוואה על הנכס">נכס שמומן בהלוואה: הוסף אותה עם &quot;+ הלוואה&quot;.</Empty></Card>
      ) : d.loans.map(l => (
        <Card key={l.id}>
          <CardHeader className="flex-wrap">
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2.5">
                <bdi>{l.lender}</bdi>
                <Badge tone={l.status === 'active' ? 'accent' : 'neutral'}>{l.kind === 'mortgage' ? 'משכנתא' : 'הלוואה'}{l.status === 'closed' ? ' · נסגרה' : ''}</Badge>
              </CardTitle>
              <p className="mt-1 text-sm text-muted">
                <bdi>{ils(l.principal)}</bdi> · ריבית <bdi>{ratePct.format(l.annual_rate)}</bdi> · <bdi>{l.term_months}</bdi> חודשים מ-<bdi>{shortDate(l.start_date)} {l.start_date.slice(0, 4)}</bdi>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {l.can_edit && l.status === 'active' && (
                <RepaymentDialog loanId={l.id} lender={l.lender} payment={l.monthly_payment} balance={l.balance} sharePct={l.venture_share_pct} path={path} today={today} />
              )}
              {d.can_delete && <VentureRemove kind="loan" id={l.id} path={path} label="למחוק את ההלוואה" />}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <Facts items={[
              { label: 'יתרה', value: <Money value={l.balance} />, hint: <>נכון ל-<bdi>{shortDate(l.balance_date)} {l.balance_date.slice(0, 4)}</bdi></> },
              { label: 'החזר חודשי', value: <Money value={l.monthly_payment} /> },
              { label: 'חלוקת כל החזר', value: <>יזמות <bdi>{sharePct(l.venture_share_pct)}</bdi> · אישי <bdi>{sharePct(100 - l.venture_share_pct)}</bdi></>,
                hint: 'החשבון שממנו משלמים נשאר באזור האישי' },
              { label: 'חודשים לסיום', value: l.months_to_payoff === null ? <span className="text-critical-ink">ההחזר לא מכסה את הריבית</span> : <bdi>{l.months_to_payoff}</bdi>,
                hint: 'לפי היתרה, הריבית וההחזר הנוכחיים' },
            ]} />

            <div className="flex flex-col gap-2 border-t border-line pt-5">
              <h3 className="text-sm font-semibold text-ink">החזרים שנרשמו</h3>
              {l.payments.length === 0 ? <p className="text-sm text-muted">אין החזרים עדיין</p> : (
                <div className="relative overflow-x-auto">
                  <table className="data-table min-w-[640px]">
                    <thead><tr>
                      <th scope="col">תאריך</th><th scope="col" className="num">סכום</th><th scope="col" className="num">ריבית</th>
                      <th scope="col" className="num">קרן</th><th scope="col" className="num">יתרה אחרי</th><th scope="col" className="num">יזמות / אישי</th>
                      <th scope="col"><span className="sr-only">פעולות</span></th>
                    </tr></thead>
                    <tbody>
                      {l.payments.map(pm => (
                        <tr key={pm.id}>
                          <td className="whitespace-nowrap text-muted"><bdi>{shortDate(pm.paid_on)}</bdi></td>
                          <td className="num font-medium"><Money value={pm.amount} /></td>
                          <td className="num"><Money value={pm.interest} /></td>
                          <td className="num"><Money value={pm.principal} /></td>
                          <td className="num"><Money value={pm.balance_after} /></td>
                          <td className="num text-xs"><Money value={pm.venture_amount} /> / <Money value={pm.personal_amount} /></td>
                          <td className="w-10 text-end">{pm.is_latest && d.can_delete && <VentureRemove kind="repayment" id={pm.id} path={path} label="לבטל את ההחזר האחרון" />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {l.schedule.length > 0 && (
              <details className="group border-t border-line pt-4">
                <summary className="cursor-pointer text-sm font-medium text-accent">לוח סילוקין ל-12 החודשים הבאים</summary>
                <div className="relative mt-3 overflow-x-auto">
                  <table className="data-table min-w-[520px]">
                    <thead><tr>
                      <th scope="col" className="num">#</th><th scope="col">תאריך</th><th scope="col" className="num">החזר</th>
                      <th scope="col" className="num">ריבית</th><th scope="col" className="num">קרן</th><th scope="col" className="num">יתרה</th>
                    </tr></thead>
                    <tbody>
                      {l.schedule.map(r => (
                        <tr key={r.n}>
                          <td className="num text-muted">{r.n}</td>
                          <td className="whitespace-nowrap"><bdi>{r.date ? `${shortDate(r.date)} ${r.date.slice(0, 4)}` : ''}</bdi></td>
                          <td className="num"><Money value={r.payment} /></td>
                          <td className="num"><Money value={r.interest} /></td>
                          <td className="num"><Money value={r.principal} /></td>
                          <td className="num"><Money value={r.balance} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted">תחזית לפי ריבית קבועה ושפיצר; לא כולל הצמדה או שינויי ריבית.</p>
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      ))}
      </Section>

      <SubjectMoney title="הכנסות והוצאות של הנכס" items={d.transactions} path={path}
        note={`ללא מע״מ · כולל חלק היזמות בהחזרי ההלוואה${y.gross !== null ? ` · תשואה ברוטו ${pctText(y.gross)}` : ''}`}
        add={d.can_edit ? { subjectType: 'asset', subjectId: p.id, today } : null} />

      <div className="grid grid-cols-1 gap-x-4 gap-y-8 xl:grid-cols-2 [&>*]:min-w-0">
        <SubjectTasks items={d.tasks} subjectType="asset" subjectId={p.id} path={path} canAdd={canTask && d.can_edit} />
        <SubjectContacts items={d.contacts} subjectType="asset" subjectId={p.id} path={path} canAdd={d.can_edit} />
      </div>
      <SubjectDocuments docs={d.documents} />
    </div>
  );
}
