import { Lock, PlugZap, Sparkles, Users } from 'lucide-react';
import type { BranchData, HeadSpaData } from '@/server/headspa';
import { ils, num, stamp } from '@/lib/format';
import { MonthlyBars } from '@/components/charts/monthly-bars';
import { DailyBars } from '@/components/charts/daily-bars';
import { KpiCard } from '@/components/dash/kpi-card';
import { RefreshButton } from '@/components/dash/refresh-button';
import { BasisToggle } from '@/components/ospa/ospa-view';
import { Tabs } from '@/components/shell/tabs';
import { PageHeader } from '@/components/shell/page-header';
import { TaskBoard } from '@/components/work/task-board';
import { GoalsPanel } from '@/components/work/goals-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';
import { HeadSpaKpis, IntegrationBadge, NamedTable, VatNote, type GoalsSummary } from './parts';

export const BRANCH_TABS = ['overview', 'sales', 'bookings', 'customers', 'staff', 'tasks', 'goals'] as const;
export type BranchTab = (typeof BRANCH_TABS)[number];

const monthName = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const mName = (iso: string) => monthName.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

// One screen for every branch, by branch id. Same layout whether the branch is open, being set up,
// or not connected yet: what it has fills in, what it lacks says "אין נתונים עדיין".
export function BranchDashboard({ d, b, tab, goals, counts, canRefresh }: {
  d: HeadSpaData; b: BranchData; tab: BranchTab; goals: GoalsSummary;
  counts: { tasks?: number; goals?: number }; canRefresh: boolean;
}) {
  const base = b.href;
  const mine = d.basis === 'mine';
  const place = { domain: 'business', branch: 'head-spa-israel', location: b.location } as const;
  const title = `סניף ${b.name_he}`;
  const connected = !!b.integration && b.integration.status !== 'disabled' && b.integration.status !== 'not_connected';
  const inclVat = b.integration?.amounts_include_vat ?? true;

  const moneyTab = ['overview', 'sales', 'bookings', 'customers', 'staff'].includes(tab);
  // The page already explains why there are no numbers (no source / in setup / no permission)
  const explained = (!connected && !b.has_data) || !b.can_see_money;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} subtitle="נתוני פעילות, ביצועים ומשימות של הסניף"
        status={<>
          {b.status === 'setup' && <Badge tone="warning">בהקמה</Badge>}
          <IntegrationBadge i={b.integration} />
        </>}
        actions={b.can_see_money ? (
          <>
            <BasisToggle basis={d.basis} share={d.share} base={base} />
            {canRefresh && connected && <RefreshButton />}
          </>
        ) : undefined}
        tabs={<Tabs base={base} active={tab} tabs={[
          { key: 'overview', label: 'סקירה' },
          { key: 'sales', label: 'מכירות' },
          { key: 'bookings', label: 'טיפולים והזמנות' },
          { key: 'customers', label: 'לקוחות' },
          { key: 'staff', label: 'צוות' },
          { key: 'tasks', label: 'משימות', count: counts.tasks },
          { key: 'goals', label: 'יעדים', count: counts.goals },
        ]} />} />

      {b.integration?.status === 'error' && (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          הסנכרון האחרון נכשל: {b.integration.last_error ?? 'שגיאה לא ידועה'}. {b.has_data ? 'מוצגים הנתונים האחרונים שנשמרו.' : ''}
        </p>
      )}
      {!connected && !b.has_data && b.can_see_money && moneyTab && (
        <Card>
          <Empty icon={<PlugZap />} title={b.status === 'setup' ? 'הסניף בהקמה' : 'אין מקור נתונים מחובר'}>
            כשיחובר לסניף מקור נתונים (חשבון <bdi>Buyz</bdi> משלו), יופיעו כאן אותם נתונים כמו בכל סניף: הכנסות, טיפולים, מכירות וצוות.
            {b.status === 'setup' ? ' בינתיים אפשר לנהל כאן משימות ויעדים להקמת הסניף.' : ''}
          </Empty>
        </Card>
      )}
      {connected && !b.has_data && b.can_see_money && moneyTab && tab !== 'overview' && (
        <Card>
          <Empty icon={<PlugZap />} title="עוד אין נתונים מ-Buyz">הסניף מחובר. הנתונים יופיעו כאן אחרי הסנכרון הבא.</Empty>
        </Card>
      )}
      {!b.can_see_money && moneyTab && (
        <Card>
          <Empty icon={<Lock />} title="אין הרשאה לנתוני הכנסות">נתוני ההכנסות של הסניף פתוחים לבעלים, למנהלים ולצופים.</Empty>
        </Card>
      )}

      {tab === 'overview' && <Overview d={d} b={b} goals={goals} mine={mine} place={place} title={title} explained={explained} />}
      {tab === 'sales' && b.can_see_money && b.has_data && <Sales b={b} />}
      {tab === 'bookings' && b.can_see_money && b.has_data && <Bookings b={b} />}
      {tab === 'customers' && b.can_see_money && b.has_data && <Customers b={b} />}
      {tab === 'staff' && b.can_see_money && b.has_data && <Staff b={b} />}
      {b.can_see_money && b.has_data && moneyTab && tab !== 'overview' && (
        <p className="-mt-2 text-xs text-muted"><VatNote rate={d.vat_rate} inclVat={inclVat} /></p>
      )}
      {tab === 'tasks' && <TaskBoard place={place} path={base} title={`משימות ${title}`} />}
      {tab === 'goals' && <GoalsPanel place={place} path={base} title={`יעדי ${title}`} />}
    </div>
  );
}

function Overview({ d, b, goals, mine, place, title, explained }: {
  d: HeadSpaData; b: BranchData; goals: GoalsSummary; mine: boolean; explained: boolean;
  place: { domain: 'business'; branch: 'head-spa-israel'; location: string }; title: string;
}) {
  const sc = (v: number | null) => (v === null ? null : mine ? (d.share === null ? null : v * d.share) : v);
  const monthly = b.monthly.slice(-12).map(m => ({ month: m.month, value: sc(m.ex) }));
  const daily = b.daily.map(x => ({ day: x.day, value: sc(x.ex) }));
  return (
    <>
      <HeadSpaKpis n={b.numbers} goals={goals} mine={mine} asOf={b.as_of} money={b.can_see_money} explained={explained} />
      {b.can_see_money && b.has_data && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <p className="text-xs text-muted xl:col-span-2"><VatNote rate={d.vat_rate} inclVat={b.integration?.amounts_include_vat ?? true} /></p>
          <Card>
            <CardHeader><CardTitle>הכנסה יומית החודש</CardTitle><span className="text-sm text-muted">לפני מע״מ</span></CardHeader>
            <CardContent>
              {daily.length >= 2 ? <DailyBars data={daily} caption="הכנסה יומית לפני מע״מ בחודש הנוכחי" /> : <p className="text-sm text-muted">אין נתונים עדיין</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>הכנסה לפי חודש</CardTitle><span className="text-sm text-muted">לפני מע״מ · 12 חודשים</span></CardHeader>
            <CardContent>
              {monthly.length >= 2 ? <MonthlyBars data={monthly} caption="הכנסה חודשית לפני מע״מ, 12 החודשים האחרונים" /> : <p className="text-sm text-muted">אין נתונים עדיין</p>}
            </CardContent>
          </Card>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <TaskBoard place={place} path={b.href} title={`משימות ${title}`} />
        <GoalsPanel place={place} path={b.href} title={`יעדי ${title}`} />
      </div>
    </>
  );
}

const SOURCES = [
  { key: 'bookings', label: 'טיפולים (תורים)' },
  { key: 'vouchers', label: 'שוברים' },
  { key: 'sales', label: 'מוצרים' },
] as const;

function Sales({ b }: { b: BranchData }) {
  const s = b.this_month;
  const parts = SOURCES.map(x => ({ ...x, total: s ? s[`${x.key}_total`] : null, count: s ? s[`${x.key}_count`] : null }));
  const whole = parts.reduce<number>((a, p) => a + (p.total ?? 0), 0);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="מכירות החודש (כולל מע״מ)" value={ils(s?.revenue_total)} reason="אין נתונים עדיין" />
        <KpiCard label="עסקאות החודש" amount={false} value={num(s?.tx_count)} reason="אין נתונים עדיין" />
        <KpiCard label="הזמנות מוצרים" amount={false} value={num(s?.orders_count)} reason="אין נתונים עדיין" />
        <KpiCard label="טרם שולם" value={ils(s?.unpaid_total)} hint={s ? 'כולל מע״מ' : undefined} reason="אין נתונים עדיין" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>מאיפה ההכנסה החודש</CardTitle><span className="text-sm text-muted">כולל מע״מ</span></CardHeader>
          <CardContent>
            {!s ? <p className="text-sm text-muted">אין נתונים עדיין</p> : (
              <ul className="flex flex-col gap-3">
                {parts.map(p => (
                  <li key={p.key} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-ink-2">{p.label}{p.count !== null && <span className="text-muted"> · {num(p.count)}</span>}</span>
                      <Money value={p.total} className="font-medium" />
                    </div>
                    {p.total !== null && whole > 0 ? (
                      <div className="h-1.5 rounded-full bg-[color:var(--grid)]" aria-hidden>
                        <div className="h-1.5 rounded-full bg-[color:var(--series-1)]" style={{ width: `${Math.max(2, (p.total / whole) * 100)}%` }} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>אמצעי תשלום החודש</CardTitle><span className="text-sm text-muted">כולל מע״מ</span></CardHeader>
          <CardContent>
            <NamedTable caption="אמצעי תשלום החודש" nameLabel="אמצעי"
              rows={b.methods.map(m => ({ name: m.label, count: m.count, total: m.total }))} />
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>מוצרים מובילים החודש</CardTitle><span className="text-sm text-muted">כולל מע״מ</span></CardHeader>
          <CardContent><NamedTable caption="מוצרים מובילים החודש" nameLabel="פריט" rows={b.items.this.slice(0, 12)} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>הכנסה לפי חודש</CardTitle><span className="text-sm text-muted">כולל מע״מ</span></CardHeader>
          <CardContent>
            {!b.monthly.length ? <p className="text-sm text-muted">אין נתונים עדיין</p> : (
              <div className="relative overflow-x-auto">
                <table className="data-table">
                  <caption className="sr-only">הכנסה ועסקאות לפי חודש</caption>
                  <thead><tr>
                    <th scope="col">חודש</th>
                    <th scope="col" className="num">עסקאות</th>
                    <th scope="col" className="num">כולל מע״מ</th>
                    <th scope="col" className="num">לפני מע״מ</th>
                  </tr></thead>
                  <tbody>
                    {b.monthly.slice(-12).reverse().map(m => (
                      <tr key={m.month}>
                        <td>{mName(m.month)}</td>
                        <td className="num">{num(m.tx) ?? '–'}</td>
                        <td className="num"><Money value={m.incl} /></td>
                        <td className="num"><Money value={m.ex} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Bookings({ b }: { b: BranchData }) {
  const s = b.this_month, l = b.last_month;
  const hist = b.monthly.filter(m => m.bookings !== null).slice(-12).map(m => ({ month: m.month, value: m.bookings }));
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="טיפולים החודש" amount={false} icon={<Sparkles className="size-4" />} value={num(s?.bookings_count)}
          hint={l?.bookings_count != null ? `חודש קודם: ${num(l.bookings_count)}` : undefined} reason="אין נתונים עדיין" />
        <KpiCard label="הכנסה מטיפולים החודש" value={ils(s?.bookings_total)} hint={s?.bookings_total != null ? 'כולל מע״מ' : undefined} reason="אין נתונים עדיין" />
        <KpiCard label="שוברים שנמכרו החודש" amount={false} value={num(s?.vouchers_count)}
          hint={s?.vouchers_total != null ? `${ils(s.vouchers_total)} כולל מע״מ` : undefined} reason="אין נתונים עדיין" />
        <KpiCard label="ביטולים החודש" amount={false} value={num(s?.cancellations_count)} reason="Buyz לא מחזיר מספר ביטולים" />
      </div>
      <Card>
        <CardHeader><CardTitle>הכנסה מטיפולים לפי חודש</CardTitle><span className="text-sm text-muted">כולל מע״מ · 12 חודשים</span></CardHeader>
        <CardContent>
          {hist.length >= 2 ? <MonthlyBars data={hist} caption="הכנסה מטיפולים (תורים) לפי חודש, כולל מע״מ" /> : <p className="text-sm text-muted">אין נתונים עדיין</p>}
          <p className="mt-3 text-xs text-muted">Buyz מדווח טיפולים כסכום וכמות תורים בחודש. פירוט תור-תור (שמות לקוחות) לא נמשך.</p>
        </CardContent>
      </Card>
    </>
  );
}

function Customers({ b }: { b: BranchData }) {
  const s = b.this_month;
  const any = s && (s.customers_count !== null || s.new_customers_count !== null);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="לקוחות החודש" amount={false} icon={<Users className="size-4" />} value={num(s?.customers_count)} reason="Buyz לא מחזיר מספר לקוחות מצטבר" />
        <KpiCard label="לקוחות חדשים החודש" amount={false} value={num(s?.new_customers_count)} reason="Buyz לא מחזיר מספר לקוחות חדשים" />
        <KpiCard label="עסקה ממוצעת" value={ils(b.numbers.avg_ticket_incl)} hint={b.numbers.avg_ticket_incl !== null ? 'כולל מע״מ' : undefined} reason="אין נתונים עדיין" />
      </div>
      {!any && (
        <Card>
          <Empty icon={<Users />} title="אין נתוני לקוחות מצטברים">
            הדשבורד שומר רק מספרים מצטברים שהמקור מחזיר, ולא מושך פרטי לקוחות (שמות, טלפונים). כש-Buyz יחזיר מספר לקוחות, הוא יופיע כאן.
          </Empty>
        </Card>
      )}
    </>
  );
}

function Staff({ b }: { b: BranchData }) {
  const months = [
    { key: 'this', title: b.this_month ? `מכירות לפי עובד/ת · ${mName(b.this_month.month)}` : 'מכירות לפי עובד/ת החודש', rows: b.staff.this },
    { key: 'last', title: b.last_month ? `מכירות לפי עובד/ת · ${mName(b.last_month.month)}` : 'מכירות לפי עובד/ת בחודש הקודם', rows: b.staff.last },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      {months.map(m => (
        <Card key={m.key}>
          <CardHeader><CardTitle>{m.title}</CardTitle><span className="text-sm text-muted">כולל מע״מ</span></CardHeader>
          <CardContent>
            <NamedTable caption={m.title} nameLabel="עובד/ת" rows={m.rows} />
            {b.as_of && <p className="mt-3 text-xs text-muted">לפי המוכר/ת שנרשם ב-Buyz · עודכן {stamp(b.as_of)}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
