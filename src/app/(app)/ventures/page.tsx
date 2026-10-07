import Link from 'next/link';
import { openCounts } from '@/server/entries';
import { requirePlace } from '@/server/auth';
import { venturesSummary } from '@/server/ventures';
import { ils, shortDate } from '@/lib/format';
import { KpiCard } from '@/components/dash/kpi-card';
import { ENTITIES } from '@/lib/places';
import { TaskBoard } from '@/components/work/task-board';
import { Card, CardContent } from '@/components/ui/card';

export const metadata = { title: 'יזמות — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

export default async function VenturesOverview() {
  const u = await requirePlace({ domain: 'ventures' });
  const [counts, s] = await Promise.all([openCounts(), venturesSummary(u)]);
  const items = ENTITIES.filter(e => e.domain === 'ventures');
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page font-bold">יזמות</h1>
        <p className="text-sm text-muted">נכסים, השקעות, משפטי ופיננסים</p>
      </div>
      {s.ready && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="שווי הנכסים" href="/ventures/real-estate" value={ils(s.properties.value)}
            hint={[`${s.properties.count} נכסים`, s.properties.has_estimate ? 'כולל הערכה' : '', s.properties.unvalued ? `${s.properties.unvalued} בלי שווי` : ''].filter(Boolean).join(' · ')}
            reason={s.properties.count ? 'לא הוזן שווי לנכסים' : 'אין נכסים עדיין'} />
          <KpiCard label="יתרת הלוואות" href="/ventures/real-estate" value={ils(s.loans.balance)}
            hint={s.loans.monthly_payment !== null ? `החזר חודשי ${ils(s.loans.monthly_payment)}` : undefined} reason="אין הלוואות" />
          <KpiCard label="הון בנכסים" href="/ventures/real-estate" value={ils(s.equity)}
            hint={s.equity !== null ? `שווי פחות חלק היזמות בהלוואות${s.properties.has_estimate ? ' · לפי הערכה' : ''}` : undefined} reason="צריך שווי לנכסים" />
          <KpiCard label="שווי ההשקעות" href="/ventures/investments" value={ils(s.investments.value)}
            hint={s.investments.gain !== null ? `רווח ${ils(s.investments.gain)}${s.investments.has_estimate ? ' · כולל הערכה' : ''}` : undefined}
            reason={s.investments.count ? 'לא הוזן שווי' : 'אין השקעות עדיין'} />
        </div>
      )}
      {s.ready && s.legal.open > 0 && (
        <p className="text-sm text-ink-2">
          <Link href="/ventures/legal-and-tasks" className="hover:underline">{s.legal.open} תיקים פתוחים</Link>
          {s.legal.overdue_deadlines > 0 && <span className="font-medium text-critical-ink"> · {s.legal.overdue_deadlines} מועדים שעברו</span>}
          {s.legal.next_deadline && <> · המועד הבא <bdi>{shortDate(s.legal.next_deadline.due_on)}</bdi>: <bdi>{s.legal.next_deadline.title}</bdi> (<bdi>{s.legal.next_deadline.case_title}</bdi>)</>}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map(e => {
          const c = counts[`ventures/${e.id}`];
          return (
            <li key={e.id}>
              <Card className="h-full hover:border-line-strong">
                <Link href={e.href} className="block p-4">
                  <p className="font-medium">{e.label}</p>
                  <p className="mt-1 text-sm text-muted">{c?.open ? `${c.open} משימות פתוחות${c.overdue ? ` · ${c.overdue} באיחור` : ''}` : 'אין משימות פתוחות'}</p>
                </Link>
              </Card>
            </li>
          );
        })}
      </ul>
      <TaskBoard place={{ domain: 'ventures', branch: null, location: null }} path="/ventures" title="כל משימות היזמות" showContext />
    </div>
  );
}
