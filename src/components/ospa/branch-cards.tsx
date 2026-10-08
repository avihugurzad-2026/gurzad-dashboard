import Link from 'next/link';
import { MapPin } from 'lucide-react';
import type { OspaData } from './ospa-view';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';

// One card per branch of Head Spa Israel, each linking to that branch's own page
export function BranchCards({ d, counts }: { d: OspaData; counts: Record<string, { open: number; overdue: number }> }) {
  const mine = d.basis === 'mine';
  return (
    <Card>
      <CardHeader><CardTitle>סניפים</CardTitle><span className="text-sm text-muted">{mine ? 'החלק שלי' : '100% מהעסק'} · לפני מע״מ</span></CardHeader>
      <CardContent>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {d.locations.map(l => {
            const href = `/business/head-spa-israel/${l.location}${mine ? '?basis=mine' : ''}`;
            const tasks = counts[`business/head-spa-israel/${l.location}`];
            return (
              <li key={l.location}>
                <Link href={href} className="flex h-full flex-col gap-2 rounded-xl border border-line p-4 transition-colors hover:border-line-strong hover:bg-surface-2/50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium"><MapPin className="size-4 text-muted" aria-hidden />סניף {l.name_he}</span>
                    <Badge tone={l.has_data ? 'good' : undefined}>{l.has_data ? 'מחובר ל-Buyz' : l.connected ? 'אין נתונים עדיין' : 'בהקמה'}</Badge>
                  </div>
                  {l.has_data ? (
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      <div><dt className="text-xs text-muted">חודש קודם</dt><dd><Money value={l.last_month} className="font-medium" /></dd></div>
                      <div><dt className="text-xs text-muted">מתחילת השנה</dt><dd><Money value={l.ytd} className="font-medium" /></dd></div>
                    </dl>
                  ) : <p className="text-sm text-muted">{l.connected ? 'הנתונים יופיעו אחרי המשיכה הבאה מ-Buyz.' : 'כשהסניף ייפתח ויחובר, יופיעו כאן אותם נתונים כמו במודיעין.'}</p>}
                  <p className="mt-auto text-xs text-muted">{tasks?.open ? `${tasks.open} משימות פתוחות${tasks.overdue ? ` · ${tasks.overdue} באיחור` : ''}` : 'אין משימות פתוחות'}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
