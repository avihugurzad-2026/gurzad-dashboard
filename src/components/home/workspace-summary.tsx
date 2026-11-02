import Link from 'next/link';
import { Briefcase, ChevronLeft, LayoutGrid, Plus, Sofa, UserRound } from 'lucide-react';
import { ils, num, NO_DATA } from '@/lib/format';
import type { Workspace } from '@/lib/workspaces';
import type { BusinessCard, PersonalCard } from '@/server/snapshot';
import { switchHousehold } from '@/app/workspace-actions';
import { WorkspaceBadge } from '@/components/workspace/workspace-ui';
import { buttonClass } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Section } from '@/components/ui/card';
import { TaskLine } from './snapshots';

// Three numbers side by side in a half-width card: section size, not KPI size, so they fit
function Metric({ label, value, sub }: { label: string; value: string | null; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-ink-2">{label}</p>
      {value === null ? <p className="mt-1.5 text-sm text-muted">{NO_DATA}</p>
        : <p className="mt-1 text-section font-bold text-ink tabular amount"><bdi>{value}</bdi></p>}
      {value !== null && sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

// Global Home: one summary card per workspace the user belongs to (from the DB). Summaries only:
// every card reads its own workspace's numbers and nothing is added across workspaces.

export type PersonalSummary = PersonalCard & { ws: Workspace | null; income: number | null; expense: number | null; net: number | null };
export type HouseholdSummary = {
  ws: Workspace; current: boolean;
  received: number | null; expected: number | null; expense: number | null; net: number | null;
  open: number; overdue: number;
};
export type BusinessSummary = BusinessCard & { expenses: number | null };

const openLink = (href: string) => (
  <Link href={href} className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-accent-ink hover:underline">
    פתח<ChevronLeft className="size-4" aria-hidden />
  </Link>
);

// A household that is not the one /household shows right now: opening it switches first
const switchTo = (id: string) => (
  <form action={switchHousehold}>
    <input type="hidden" name="ws" value={id} />
    <button type="submit" className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-accent-ink hover:underline">
      פתח<ChevronLeft className="size-4" aria-hidden />
    </button>
  </form>
);

function WsCard({ ws, title, icon, children, foot, open }: {
  ws: Workspace; title?: string; icon: React.ReactNode; children: React.ReactNode; foot?: React.ReactNode; open?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-muted [&_svg]:size-[18px]" aria-hidden>{icon}</span><bdi>{title ?? ws.name}</bdi><WorkspaceBadge ws={ws} />
        </CardTitle>
        {open ?? openLink(ws.href)}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-3">{children}</div>
        {foot}
      </CardContent>
    </Card>
  );
}

const profit = (rev: number | null | undefined, exp: number | null) => (rev != null && exp != null ? rev - exp : null);

export function WorkspaceSummaries({ personal, households, businesses, businessWs, periodLabel, showHouseholds }: {
  personal: PersonalSummary | null; households: HouseholdSummary[];
  businesses: BusinessSummary[]; businessWs: Workspace[]; periodLabel: string; showHouseholds: boolean;
}) {
  const noHousehold = showHouseholds && households.length === 0;
  if (!personal && households.length === 0 && businesses.length === 0 && !noHousehold) return null;
  return (
    <Section title={<><LayoutGrid className="size-[18px] text-muted" aria-hidden />האזורים שלי</>}
      action={<span className="text-sm text-muted">סיכום לכל אזור בנפרד, בלי לערבב ביניהם</span>}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {personal?.ws && (
          <WsCard ws={personal.ws} icon={<UserRound />}
            foot={<TaskLine open={personal.weekTasks} urgent={0} overdue={personal.weekOverdue} />}>
            <Metric label="הכנסות החודש" value={ils(personal.income)} />
            <Metric label="הוצאות החודש" value={ils(personal.expense)} />
            <Metric label="נטו" value={ils(personal.net)} />
          </WsCard>
        )}
        {households.map(h => (
          <WsCard key={h.ws.id} ws={h.ws} icon={<Sofa />} open={h.current ? undefined : switchTo(h.ws.id)}
            foot={<TaskLine open={h.open} urgent={0} overdue={h.overdue} />}>
            <Metric label="העברות לבית החודש" value={ils(h.received)} sub={h.expected !== null ? `מתוך ${ils(h.expected)}` : undefined} />
            <Metric label="הוצאות משותפות החודש" value={ils(h.expense)} />
            <Metric label="יתרה" value={ils(h.net)} />
          </WsCard>
        ))}
        {noHousehold && (
          <Card className="flex flex-col justify-center">
            <CardContent className="flex flex-col items-start gap-3 pt-5 sm:pt-6">
              <p className="flex items-center gap-2 text-card font-semibold text-ink"><Sofa className="size-[18px] text-muted" aria-hidden />משק בית</p>
              <p className="text-sm text-muted">עוד אין לך משק בית. משק בית משותף למשפחה: משימות, הוצאות ותקציב. האזור האישי נשאר פרטי.</p>
              <Link href="/household" className={buttonClass('secondary', 'sm')}><Plus aria-hidden />צור משק בית</Link>
            </CardContent>
          </Card>
        )}
        {businesses.map(b => {
          const ws = businessWs.find(w => w.branch === b.branch);
          if (!ws) return null;
          const rev = b.revenue?.net ?? null;
          return (
            <WsCard key={b.branch} ws={ws} icon={<Briefcase />}
              foot={<>
                {b.revenueSource === 'buyz' && <p className="text-xs text-muted">הכנסות ממערכת הקופה, הוצאות מהדשבורד</p>}
                <TaskLine open={b.open} urgent={b.urgent} overdue={b.overdue} />
              </>}>
              {b.revenue ? (
                <>
                  <Metric label={`הכנסות ${periodLabel}`} value={ils(rev)} sub={b.revenue.count ? `${num(b.revenue.count)} תנועות · בלי מע״מ` : 'בלי מע״מ'} />
                  <Metric label="הוצאות" value={ils(b.expenses)} sub="בלי מע״מ" />
                  <Metric label="רווח" value={ils(profit(rev, b.expenses))} />
                </>
              ) : <p className="col-span-full text-sm text-muted">אין לך הרשאה לנתונים הכספיים של העסק הזה</p>}
            </WsCard>
          );
        })}
      </div>
    </Section>
  );
}
