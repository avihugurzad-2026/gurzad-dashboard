import Link from 'next/link';
import { Briefcase, ChevronLeft, LayoutGrid, Sofa, UserRound } from 'lucide-react';
import { ils, num, NO_DATA } from '@/lib/format';
import { HOUSEHOLD, PERSONAL, type Workspace } from '@/lib/workspaces';
import type { BusinessCard, PersonalCard } from '@/server/snapshot';
import { WorkspaceBadge } from '@/components/workspace/workspace-ui';
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

// Global Home: one summary card per workspace. Summaries only: every card reads its own
// workspace's numbers and nothing is added across workspaces (no mixed ledgers).

export type HouseholdSummary = { expense: number | null; homeOpen: number; homeOverdue: number };
export type BusinessSummary = BusinessCard & { expenses: number | null };

function WsCard({ ws, title, icon, children, foot }: { ws: Workspace; title?: string; icon: React.ReactNode; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-muted [&_svg]:size-[18px]" aria-hidden>{icon}</span><bdi>{title ?? ws.name}</bdi><WorkspaceBadge ws={ws} />
        </CardTitle>
        <Link href={ws.href} className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-accent-ink hover:underline">
          פתח<ChevronLeft className="size-4" aria-hidden />
        </Link>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-3">{children}</div>
        {foot}
      </CardContent>
    </Card>
  );
}

const profit = (rev: number | null | undefined, exp: number | null) => (rev != null && exp != null ? rev - exp : null);

export function WorkspaceSummaries({ personal, household, businesses, businessWs, periodLabel }: {
  personal: PersonalCard | null; household: HouseholdSummary | null;
  businesses: BusinessSummary[]; businessWs: Workspace[]; periodLabel: string;
}) {
  if (!personal && !household && businesses.length === 0) return null;
  return (
    <Section title={<><LayoutGrid className="size-[18px] text-muted" aria-hidden />האזורים שלי</>}
      action={<span className="text-sm text-muted">סיכום לכל אזור בנפרד, בלי לערבב ביניהם</span>}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {personal && (
          <WsCard ws={PERSONAL} title="אישי" icon={<UserRound />}
            foot={<TaskLine open={personal.weekTasks} urgent={0} overdue={personal.weekOverdue} />}>
            <Metric label="הכנסה אישית" value={null} />
            <Metric label="הוצאות אישיות" value={null} />
            <Metric label="נטו" value={null} />
          </WsCard>
        )}
        {household && (
          <WsCard ws={HOUSEHOLD} icon={<Sofa />}
            foot={<TaskLine open={household.homeOpen} urgent={0} overdue={household.homeOverdue} />}>
            <Metric label="תקציב משותף" value={null} />
            <Metric label="הוצאות משותפות החודש" value={ils(household.expense)} />
            <Metric label="יתרה" value={null} />
          </WsCard>
        )}
        {businesses.map(b => {
          const ws = businessWs.find(w => w.id === b.branch);
          if (!ws) return null;
          const rev = b.revenue?.net ?? null;
          return (
            <WsCard key={b.branch} ws={ws} icon={<Briefcase />}
              foot={<>
                {b.revenueSource === 'buyz' && <p className="text-xs text-muted">הכנסות מ-Buyz, הוצאות מהדשבורד</p>}
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
      {personal && <p className="text-xs text-muted">הפיננסים האישיים והתקציב המשותף יתחברו בשלב בניית מסד הנתונים של האזורים.</p>}
    </Section>
  );
}
