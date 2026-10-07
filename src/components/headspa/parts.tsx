import { CalendarDays, CircleDollarSign, Ban, Receipt, Sparkles, Target, Users } from 'lucide-react';
import type { BranchIntegration, Named } from '@/server/headspa';
import { ils, num, stamp } from '@/lib/format';
import { KpiCard } from '@/components/dash/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';

export type KpiNumbers = {
  today_ex: number | null; today_incl: number | null; month_ex: number | null; month_incl: number | null;
  bookings_count: number | null; avg_ticket_incl: number | null; customers: number | null; cancellations: number | null;
};
export type GoalsSummary = { total: number; done: number; active: number; avg_pct: number | null } | null;

const pct = (x: number) => `${Math.round(x * 100)}%`;

// The seven headline numbers of Head Spa (company or one branch). Each null → "אין נתונים עדיין".
export function HeadSpaKpis({ n, goals, mine, asOf, money = true }: {
  n: KpiNumbers; goals: GoalsSummary; mine: boolean; asOf: string | null; money?: boolean;
}) {
  const noData = money ? 'עוד לא נמשכו נתונים מ-Buyz' : 'אין הרשאה לנתוני הכנסות';
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
      <KpiCard label="יעדים" icon={<Target className="size-4" />} amount={false}
        value={goals ? `${num(goals.done)}/${num(goals.total)}` : null}
        hint={goals ? `הושגו${goals.avg_pct !== null ? ` · התקדמות ממוצעת ${pct(goals.avg_pct)}` : ''}` : undefined}
        reason="לא הוגדרו יעדים" />
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
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead><tr className="border-b border-line text-xs text-muted">
          <th scope="col" className="py-2 text-start font-medium">{nameLabel}</th>
          <th scope="col" className="py-2 text-start font-medium">כמות</th>
          <th scope="col" className="py-2 text-end font-medium">סכום</th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.name} className="border-b border-line last:border-0">
              <th scope="row" className="max-w-[16rem] truncate py-2 text-start font-normal"><bdi>{r.name}</bdi></th>
              <td className="py-2 tabular">{num(r.count) ?? '–'}</td>
              <td className="py-2 text-end"><Money value={r.total} /></td>
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
