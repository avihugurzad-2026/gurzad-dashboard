import Link from 'next/link';
import { openCounts } from '@/server/entries';
import { ENTITIES } from '@/lib/places';
import { TaskBoard } from '@/components/work/task-board';
import { Card, CardContent } from '@/components/ui/card';

export const metadata = { title: 'יזמות — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

export default async function VenturesOverview() {
  const counts = await openCounts();
  const items = ENTITIES.filter(e => e.domain === 'ventures');
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">יזמות</h1>
        <p className="text-sm text-muted">נכסים, השקעות, משפטי ופיננסים</p>
      </div>
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
