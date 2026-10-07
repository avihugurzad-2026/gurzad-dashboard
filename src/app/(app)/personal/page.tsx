import Link from 'next/link';
import { requireUser } from '@/server/auth';
import { householdTransactions } from '@/server/finance';
import { ListChecks, Scale, Target } from 'lucide-react';
import { goalsFor, openCounts, PERSONAL_LISTS } from '@/server/entries';
import { todayIL } from '@/lib/period';
import { ils, num } from '@/lib/format';
import { KpiCard } from '@/components/dash/kpi-card';
import { TaskBoard } from '@/components/work/task-board';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = { title: 'אישי — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const PLACE = { domain: 'personal', branch: null, location: null } as const;

export default async function PersonalOverview() {
  const [counts, money, goals] = await Promise.all([openCounts(), requireUser().then(u => householdTransactions(u, todayIL().slice(0, 7))), goalsFor(PLACE)]);
  const balance = money.income !== null || money.expense !== null ? (money.income ?? 0) - (money.expense ?? 0) : null;
  const active = goals.goals.filter(g => g.status === 'active');
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page font-bold">אישי</h1>
        <p className="text-sm text-muted">בית, אישי, לימודים וכספים משותפים</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="משימות פתוחות" icon={<ListChecks className="size-4" />} amount={false} href="/personal/tasks"
          value={num(counts.personal?.open ?? 0)} hint={counts.personal?.overdue ? `${counts.personal.overdue} באיחור` : undefined} />
        <KpiCard label="מאזן החודש בבית" icon={<Scale className="size-4" />} href="/personal/finance" value={ils(balance)}
          reason="עוד לא הוזנו הכנסות או הוצאות החודש" />
        <KpiCard label="יעדים פיננסיים" icon={<Target className="size-4" />} amount={false} href="/personal/goals"
          value={active.length ? num(active.length) : null} reason="עוד לא הוגדרו יעדים" hint="פעילים" />
      </div>
      <Card>
        <CardHeader><CardTitle>לפי רשימה</CardTitle></CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {PERSONAL_LISTS.map(l => {
              const c = counts[`personal:${l.key}`];
              return (
                <li key={l.key}>
                  <Link href={`/personal/tasks?tab=${l.key}`} className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 hover:bg-surface-2">
                    <span className="font-medium">{l.label}</span>
                    <span className="text-sm text-muted">{c?.open ? `${c.open} פתוחות` : 'אין פתוחות'}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      <TaskBoard place={PLACE} path="/personal" title="משימות אישיות" withOwner showContext />
    </div>
  );
}
