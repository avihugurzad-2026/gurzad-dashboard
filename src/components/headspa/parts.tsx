import { CalendarDays, CircleDollarSign, Ban, Lock, PlugZap, Receipt, Sparkles, Target, Users } from 'lucide-react';
import type { BranchIntegration, Named } from '@/server/headspa';
import { ils, num, stamp } from '@/lib/format';
import { KpiCard } from '@/components/dash/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';

export type KpiNumbers = {
  today_ex: number | null; today_incl: number | null; month_ex: number | null; month_incl: number | null;
  bookings_count: number | null; avg_ticket_incl: number | null; customers: number | null; cancellations: number | null;
};
export type GoalsSummary = { total: number; done: number; active: number; avg_pct: number | null } | null;

const pct = (x: number) => `${Math.round(x * 100)}%`;

// The seven headline numbers of Head Spa (company or one branch). Each null → "אין נתונים עדיין".
// When all six Buyz numbers are null for the same reason, one empty state replaces the six empty
// cards (`explained` = the page already shows that empty state); the goals card stays if it has data.
export function HeadSpaKpis({ n, goals, mine, asOf, money = true, explained = false }: {
  n: KpiNumbers; goals: GoalsSummary; mine: boolean; asOf: string | null; money?: boolean; explained?: boolean;
}) {
  const noData = money ? 'עוד לא נמשכו נתונים מ-Buyz' : 'אין הרשאה לנתוני הכנסות';
  const goalsCard = (
    <KpiCard label="יעדים" icon={<Target className="size-4" />} amount={false}
      value={goals ? `${num(goals.done)}/${num(goals.total)}` : null}
      hint={goals ? `הושגו${goals.avg_pct !== null ? ` · התקדמות ממוצעת ${pct(goals.avg_pct)}` : ''}` : undefined}
      reason="לא הוגדרו יעדים" />
  );
  const allNull = [n.today_ex, n.month_ex, n.bookings_count, n.avg_ticket_incl, n.customers, n.cancellations].every(v => v === null);
  if (allNull) {
    return (
      <div className="flex flex-col gap-4">
        {!explained && (
          <Card>
            <Empty icon={money ? <PlugZap /> : <Lock />} title={money ? 'עוד אין נתונים מ-Buyz' : 'אין הרשאה לנתוני הכנסות'}>
              {money
                ? 'הכנסות, טיפולים, עסקה ממוצעת, לקוחות וביטולים יופיעו כאן אחרי המשיכה הראשונה מ-Buyz.'
                : 'נתוני ההכנסות פתוחים לבעלים, למנהלים ולצופים.'}
            </Empty>
          </Card>
        )}
        {goals && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{goalsCard}</div>}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label={mine ? 'החלק שלי בהכנסה היום' : 'הכנסה היום'} icon={<CalendarDays className="size-4" />}
        value={ils(n.today_ex)} hint={n.today_incl !== null ? `${ils(n.today_incl)} כולל מע״מ` : undefined}
        reason={money ? (asOf ? `אין נתון להיום בסנכרון האחרון (${stamp(asOf)})` : noData) : noData} />
      <KpiCard label={mine ? 'החלק שלי בהכנסה החודש' : 'הכנסה החודש'} icon={<CircleDollarSign className="size-4" />}
        value={ils(n.month_ex)} hint={n.month_incl !== null ? `${ils(n.month_incl)} כולל מע״מ` : undefined} reason={noData}
        foot={asOf ? <>עודכן {stamp(asOf)}</> : null} />
      <KpiCard label="טיפולים החודש" icon={<Sparkles className="size-4" />} amount={false}
        value={num(n.bookings_count)} hint={n.bookings_count !== null ? 'תורים שנקבעו ב-Buyz' : undefined} reason={noData} />
      <KpiCard label="עסקה ממוצעת" icon={<Receipt className="size-4" />}
        value={ils(n.avg_ticket_incl)} hint={n.avg_ticket_incl !== null ? 'כולל מע״מ, 100% מהעסק' : undefined} reason={noData} />
      <KpiCard label="לקוחות החודש" icon={<Users className="size-4" />} amount={false}
        value={num(n.customers)} reason={money ? 'Buyz לא מחזיר מספר לקוחות מצטבר' : noData} />
      <KpiCard label="ביטולים החודש" icon={<Ban className="size-4" />} amount={false}
        value={num(n.cancellations)} reason={money ? 'Buyz לא מחזיר מספר ביטולים' : noData} />
      {goalsCard}
    </div>
  );
}

export function IntegrationBadge({ i }: { i: BranchIntegration | null }) {
  if (!i || i.status === 'not_connected') return <Badge>אין מקור נתונים מחובר</Badge>;
  if (i.status === 'disabled') return <Badge>החיבור מושבת</Badge>;
  if (i.status === 'error') return <Badge tone="critical" title={i.last_error ?? undefined}>שגיאת סנכרון</Badge>;
  return <Badge tone="good">מחובר ל-<bdi>Buyz</bdi>{i.last_sync_at ? ` · ${stamp(i.last_sync_at)}` : ''}</Badge>;
}

export function NamedTable({ rows, caption, nameLabel, empty = 'אין נתונים עדיין' }: {
  rows: Named[]; caption: string; nameLabel: string; empty?: string;
}) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead><tr>
          <th scope="col">{nameLabel}</th>
          <th scope="col" className="num">כמות</th>
          <th scope="col" className="num">סכום</th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.name}>
              <td className="max-w-[16rem] truncate"><bdi>{r.name}</bdi></td>
              <td className="num">{num(r.count) ?? '–'}</td>
              <td className="num"><Money value={r.total} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Buyz amounts include VAT (revenue_sources / integrations config); the KPIs lead with ex-VAT
export function VatNote({ rate, inclVat }: { rate: number | null; inclVat: boolean | null }) {
  const r = rate !== null ? ` (${pct(rate)})` : '';
  if (inclVat === false) return <>הסכומים מהמקור לא כוללים מע״מ</>;
  return <>Buyz מדווח סכומים כולל מע״מ; הכותרות מוצגות לפני מע״מ{r}</>;
}
