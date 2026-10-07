import Link from 'next/link';
import { CircleCheck, Clock, OctagonAlert, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Money } from '@/components/ui/money';
import { SnoozeForm } from './snooze-form';

export type Item = {
  id: number | null; rule_id: string; severity: 'red' | 'orange'; title: string;
  amount?: number | null; open_days?: number | null; suggested_action?: string | null; owner?: string | null;
};

// Red first, then orange; each row carries the first step and who owns it (never colour alone)
export function Attention({ items, more, snoozed, evaluated }: {
  items: Item[]; more: number; snoozed: number; evaluated: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>דורש תשומת לב</CardTitle>
        {snoozed > 0 && <Link href="/health#alerts" className="text-sm text-accent hover:underline">{snoozed} נדחו</Link>}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          evaluated
            ? <Empty icon={<CircleCheck className="size-6 text-good" />} title="הכול תקין">
                אין חריגות פתוחות. הבדיקה רצה בסנכרון האחרון.
              </Empty>
            : <Empty icon={<Clock className="size-6" />} title="הבדיקה עוד לא רצה"
                action={{ href: '/health', label: 'מה חסר' }}>
                צריך להריץ סנכרון אחד מלא כדי שהחריגות ייבדקו.
              </Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-[color:var(--border)]">
            {items.map((item, i) => {
              const red = item.severity === 'red';
              const Icon = red ? OctagonAlert : TriangleAlert;
              return (
                <li key={item.id ?? `${item.rule_id}-${i}`} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 py-3 first:pt-0 last:pb-0">
                  <Icon className={red ? 'mt-0.5 size-[18px] shrink-0 text-critical' : 'mt-0.5 size-[18px] shrink-0 text-warning'} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink"><bdi>{item.title}</bdi></p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                      <Badge tone={red ? 'critical' : 'warning'}>{red ? 'דחוף' : 'לטיפול'}</Badge>
                      {item.amount != null && <Money value={item.amount} className="text-ink-2" />}
                      {item.open_days != null && <span>פתוח {item.open_days} ימים</span>}
                      {item.suggested_action && <span className="text-ink-2">{item.suggested_action}</span>}
                      {item.owner && <span>בעלים: <bdi>{item.owner}</bdi></span>}
                    </div>
                  </div>
                  {item.id !== null && <SnoozeForm id={item.id} />}
                </li>
              );
            })}
            {more > 0 && (
              <li className="pt-3">
                <Link href="/health#alerts" className="text-sm font-medium text-accent hover:underline">ועוד {more} פריטים</Link>
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
