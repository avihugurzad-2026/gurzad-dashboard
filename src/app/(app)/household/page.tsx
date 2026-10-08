import Link from 'next/link';
import { ChevronLeft, HandCoins, ListChecks, Receipt, Scale } from 'lucide-react';
import { openCounts } from '@/server/entries';
import { householdContributions, ledgerAccess, monthSummary } from '@/server/ledger';
import { todayIL } from '@/lib/period';
import { ils, num } from '@/lib/format';
import { HOUSEHOLD_MODULES } from '@/lib/workspaces';
import { KpiCard } from '@/components/dash/kpi-card';
import { TaskBoard } from '@/components/work/task-board';
import { PrivacyBoundary } from '@/components/workspace/privacy-boundary';
import { roleLabel } from '@/components/workspace/role-label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, Section } from '@/components/ui/card';
import { PageHeader } from '@/components/shell/page-header';
import { HouseholdBadge, HouseholdNav } from './area-nav';
import { householdContext } from './context';

export const metadata = { title: 'משק בית — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const PAYMENT: Record<string, { label: string; tone: 'good' | 'warning' | 'neutral' }> = {
  received: { label: 'ההעברה התקבלה', tone: 'good' },
  partial: { label: 'התקבלה חלקית', tone: 'warning' },
  pending: { label: 'ממתינה', tone: 'neutral' },
};

// The household overview: this month's shared money (contributions, shared spending, balance),
// the members, the privacy boundary and the household's tasks. Every number is this household's only.
export default async function HouseholdOverview() {
  const { u, w, members, place } = await householdContext();
  const today = todayIL();
  const month = today.slice(0, 7);
  const access = await ledgerAccess(u, w.id);
  const [counts, sum, contrib] = await Promise.all([
    openCounts(),
    access ? monthSummary(w.id, month) : null,
    access ? householdContributions(w.id, `${month}-01`, today) : null,
  ]);
  const tasks = counts[`household/${w.branch}`];
  const paid = new Map((contrib?.month?.rows ?? []).map(r => [r.user_id, r.status]));
  const received = contrib?.month?.received ?? null;
  const expected = contrib?.month?.expected ?? null;
  const links = HOUSEHOLD_MODULES.filter(m => m.key !== 'overview');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.name} subtitle="מה שמשותף לבית: משימות, הוצאות, תקציב וחיסכון" status={<HouseholdBadge members={members.length} />} tabs={<HouseholdNav />} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="העברות לבית החודש" icon={<HandCoins className="size-4" />} href="/household/budget"
          value={ils(received)} hint={expected !== null ? `מתוך ${ils(expected)} צפוי` : undefined}
          reason="עוד לא הוגדרו העברות לבית" />
        <KpiCard label="הוצאות משותפות החודש" icon={<Receipt className="size-4" />} href="/household/finance"
          value={ils(sum?.expense)} reason="עוד לא נרשמו הוצאות משותפות החודש" />
        <KpiCard label="יתרה החודש" icon={<Scale className="size-4" />} href="/household/finance"
          value={ils(sum?.net)} reason="תופיע אחרי שיירשמו תנועות" />
        <KpiCard label="משימות פתוחות" icon={<ListChecks className="size-4" />} amount={false} href="/household/tasks"
          value={tasks ? num(tasks.open) : null} hint={tasks?.overdue ? `${tasks.overdue} באיחור` : undefined}
          reason="אין משימות פתוחות לבית" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.3fr] [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>חברים</CardTitle>
            <Link href="/household/members" className="shrink-0 text-sm font-medium text-accent-ink hover:underline">ניהול חברים</Link>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {members.map(m => {
                const s = paid.get(m.user_id);
                return (
                  <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span className="flex items-center gap-3">
                      <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-ink" aria-hidden>{m.name.slice(0, 1)}</span>
                      <span className="flex flex-col">
                        <span className="text-body font-medium text-ink"><bdi>{m.name}</bdi></span>
                        <span className="text-xs text-muted">{roleLabel(m.role, 'household')}</span>
                      </span>
                    </span>
                    {s ? <Badge tone={PAYMENT[s].tone}>{PAYMENT[s].label}</Badge>
                      : <span className="text-sm text-muted">אין העברה מוגדרת החודש</span>}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
        <PrivacyBoundary />
      </div>

      <Section title="מודולים">
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {links.map(m => (
            <li key={m.key}>
              <Link href={m.href} className="flex h-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-body font-medium text-ink transition-colors hover:border-line-strong">
                {m.label}<ChevronLeft className="size-4 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <TaskBoard place={place} path="/household" title="משימות הבית" withOwner />
    </div>
  );
}
