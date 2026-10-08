import Link from 'next/link';
import { ListChecks, PiggyBank, Receipt, Scale } from 'lucide-react';
import { requireUser } from '@/server/auth';
import { householdTransactions } from '@/server/finance';
import { openCounts } from '@/server/entries';
import { todayIL } from '@/lib/period';
import { ils, num } from '@/lib/format';
import { HOUSEHOLD, ROLE_LABEL } from '@/lib/workspaces';
import { KpiCard } from '@/components/dash/kpi-card';
import { TaskBoard } from '@/components/work/task-board';
import { PrivacyBoundary } from '@/components/workspace/privacy-boundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shell/page-header';
import { HouseholdBadge, HouseholdNav } from './area-nav';

export const metadata = { title: 'הבית שלנו — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

// The household workspace overview: shared budget (sum of contributions), shared spending, balance.
// Contributions are not stored yet (UI stage), so the budget and the balance say so instead of a number.
export default async function HouseholdOverview() {
  const u = await requireUser();
  const [counts, money] = await Promise.all([openCounts(), householdTransactions(u, todayIL().slice(0, 7))]);
  const home = counts['personal:home'];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={HOUSEHOLD.name} subtitle={HOUSEHOLD.description} status={<HouseholdBadge />} tabs={<HouseholdNav />} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="תקציב הבית החודש" icon={<PiggyBank className="size-4" />} href="/household/budget" value={null}
          reason="עוד לא הוגדרו העברות לבית" />
        <KpiCard label="הוצאות משותפות החודש" icon={<Receipt className="size-4" />} href="/household/finance" value={ils(money.expense)}
          reason="עוד לא הוזנו הוצאות משותפות החודש" />
        <KpiCard label="יתרה בתקציב" icon={<Scale className="size-4" />} href="/household/budget" value={null}
          reason="תופיע אחרי שיוגדר תקציב" />
        <KpiCard label="משימות הבית" icon={<ListChecks className="size-4" />} amount={false} href="/household/tasks"
          value={num(home?.open ?? 0)} hint={home?.overdue ? `${home.overdue} באיחור` : undefined} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.3fr] [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>חברים</CardTitle>
            <Link href="/household/members" className="shrink-0 text-sm font-medium text-accent-ink hover:underline">ניהול</Link>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {HOUSEHOLD.members.map(m => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-ink" aria-hidden>{m.name.slice(0, 1)}</span>
                    <span className="flex flex-col">
                      <span className="text-body font-medium text-ink">{m.name}</span>
                      <span className="text-xs text-muted">{ROLE_LABEL[m.role]}</span>
                    </span>
                  </span>
                  <span className="text-sm text-muted">העברה: עוד לא הוגדרה</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <PrivacyBoundary />
      </div>
      <TaskBoard place={{ domain: 'personal', branch: null, location: null }} category="home" path="/household" title="משימות הבית" withOwner />
    </div>
  );
}
