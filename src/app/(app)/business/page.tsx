import Link from 'next/link';
import { requirePlace } from '@/server/auth';
import { MapPin } from 'lucide-react';
import { openCounts } from '@/server/entries';
import { ENTITIES, LOCATIONS } from '@/lib/places';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const metadata = { title: 'עסקים — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

export default async function BusinessOverview() {
  await requirePlace({ domain: 'business' });
  const counts = await openCounts();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page font-bold">עסקים</h1>
        <p className="text-sm text-muted">a-digital ו-Head Spa Israel</p>
      </div>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ENTITIES.filter(e => e.domain === 'business').map(e => {
          const c = counts[`business/${e.id}`];
          const locs = LOCATIONS.filter(l => l.entity === e.id);
          return (
            <li key={e.id}>
              <Card className="h-full">
                <CardContent className="flex flex-col gap-3 pt-5">
                  <Link href={e.href} className="text-lg font-semibold hover:underline"><bdi>{e.label}</bdi></Link>
                  <p className="text-sm text-muted">{c?.open ? `${c.open} משימות פתוחות${c.overdue ? ` · ${c.overdue} באיחור` : ''}` : 'אין משימות פתוחות'}</p>
                  {locs.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {locs.map(l => (
                        <li key={l.id}>
                          <Link href={`${e.href}/${l.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
                            <MapPin className="size-3.5 text-muted" aria-hidden />{l.label}
                            {l.status === 'setup' && <Badge tone="warning">בהקמה</Badge>}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
