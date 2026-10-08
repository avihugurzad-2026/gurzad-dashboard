import Link from 'next/link';
import { ChevronLeft, House, ListChecks, Target, Wallet } from 'lucide-react';
import { goalsFor, openCounts } from '@/server/entries';
import { num } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { currentHousehold, personalWorkspace } from '@/server/workspaces';
import { KpiCard } from '@/components/dash/kpi-card';
import { TaskBoard } from '@/components/work/task-board';
import { Card, Section } from '@/components/ui/card';
import { PageHeader } from '@/components/shell/page-header';
import { PersonalBadge, PersonalNav } from './area-nav';

export const metadata = { title: 'אישי — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const PLACE = { domain: 'personal', branch: null, location: null } as const;
// The personal lists; "בית" moved to the household workspace
const LISTS = [{ key: 'personal', label: 'אישי' }, { key: 'study', label: 'לימודים' }] as const;

export default async function PersonalOverview() {
  const u = await requireUser();
  const [counts, goals, me, hh] = await Promise.all([openCounts(), goalsFor(PLACE), personalWorkspace(u), currentHousehold(u)]);
  const active = goals.goals.filter(g => g.status === 'active');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={me?.name ?? 'אישי'} subtitle="המשימות, הכסף והמסמכים שלך. פרטי: רק אתה רואה את האזור הזה" status={<PersonalBadge />} tabs={<PersonalNav />} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="משימות פתוחות" icon={<ListChecks className="size-4" />} amount={false} href="/personal/tasks"
          value={num(counts.personal?.open ?? 0)} hint={counts.personal?.overdue ? `${counts.personal.overdue} באיחור` : undefined} />
        <KpiCard label="נטו אישי החודש" icon={<Wallet className="size-4" />} href="/personal/money" value={null}
          reason="הפיננסים האישיים עוד לא מחוברים" />
        <KpiCard label="יעדים" icon={<Target className="size-4" />} amount={false} href="/personal/goals"
          value={active.length ? num(active.length) : null} reason="עוד לא הוגדרו יעדים" hint="פעילים" />
      </div>
      <Section title="לפי רשימה">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {LISTS.map(l => {
            const c = counts[`personal:${l.key}`];
            return (
              <li key={l.key}>
                <Link href={`/personal/tasks?tab=${l.key}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-5 py-4 transition-colors hover:border-line-strong">
                  <span className="font-medium">{l.label}</span>
                  <span className="text-sm text-muted">{c?.open ? `${c.open} פתוחות` : 'אין פתוחות'}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <Card className="h-full transition-colors hover:border-line-strong">
              <Link href="/household" className="flex h-full items-center justify-between gap-3 rounded-xl px-5 py-4">
                <span className="flex items-center gap-2 font-medium"><House className="size-4 text-muted" aria-hidden /><bdi>{hh?.name ?? 'משק בית'}</bdi></span>
                <span className="flex items-center gap-1 text-sm text-muted">{hh ? 'אזור משותף' : 'עוד לא נוצר'}<ChevronLeft className="size-4" aria-hidden /></span>
              </Link>
            </Card>
          </li>
        </ul>
      </Section>
      <TaskBoard place={PLACE} path="/personal" title="משימות אישיות" withOwner showContext />
    </div>
  );
}
