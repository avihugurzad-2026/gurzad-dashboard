import { ListChecks } from 'lucide-react';
import { resolveWorkspace, tasks, workspaces, type Task } from '@/server/data';
import { daysAgo, shortDate } from '@/lib/format';
import { Filters } from '@/components/shell/filters';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, type Tone } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';

export const metadata = { title: 'משימות — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const PRIORITY: Record<string, { label: string; tone: Tone }> = {
  high: { label: 'דחוף', tone: 'critical' },
  medium: { label: 'רגיל', tone: 'warning' },
  low: { label: 'לא דחוף', tone: 'neutral' },
};

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [ws, branch] = await Promise.all([workspaces(), resolveWorkspace(sp.w)]);
  const d = await tasks(branch);
  const overdue = d.tasks.filter(t => t.days_past !== null);
  const upcoming = d.tasks.filter(t => t.days_past === null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold">משימות</h1>
          <p className="text-sm text-muted">מהוואלט, קריאה בלבד. סימון כבוצע נעשה ב-Obsidian.</p>
        </div>
        <Filters workspaces={ws} workspace={branch} />
      </div>

      {!d.synced ? (
        <Card><CardContent className="pt-5">
          <Empty icon={<ListChecks className="size-6" />} title="עוד לא סונכרנו משימות" action={{ href: '/health', label: 'מצב הסנכרון' }}>
            המשימות מגיעות מהוואלט בסנכרון. צריך להריץ סנכרון אחד.
          </Empty>
        </CardContent></Card>
      ) : d.tasks.length === 0 ? (
        <Card><CardContent className="pt-5">
          <Empty icon={<ListChecks className="size-6 text-good" />} title="אין משימות פתוחות">
            כל המשימות בטווח הזה סומנו כבוצעו.
          </Empty>
        </CardContent></Card>
      ) : (
        <>
          {overdue.length > 0 && <TaskList title={`באיחור (${overdue.length})`} items={overdue} />}
          {upcoming.length > 0 && <TaskList title={`פתוחות (${upcoming.length})`} items={upcoming} />}
        </>
      )}
    </div>
  );
}

function TaskList({ title, items }: { title: string; items: Task[] }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-ink-2">{title}</h2>
      <Card>
        <ul className="flex flex-col divide-y divide-[color:var(--border)] px-5 py-1">
          {items.map(t => {
            const p = t.priority ? PRIORITY[t.priority] : null;
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3">
                <p className="min-w-0 flex-1 text-sm text-ink"><bdi>{t.text}</bdi></p>
                <div className="flex items-center gap-2 text-xs text-muted">
                  {p && <Badge tone={p.tone}>{p.label}</Badge>}
                  <span><bdi>{t.branch}</bdi></span>
                  {t.due && <span>{shortDate(t.due)}</span>}
                  {t.days_past !== null && <span className="text-critical-ink">באיחור {daysAgo(t.days_past).replace('לפני ', '')}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
