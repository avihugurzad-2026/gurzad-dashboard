import Link from 'next/link';
import { requirePlace } from '@/server/auth';
import { ChevronLeft, MapPin } from 'lucide-react';
import { openCounts } from '@/server/entries';
import { ENTITIES, LOCATIONS } from '@/lib/places';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shell/page-header';

export const metadata = { title: 'עסקים — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

export default async function BusinessOverview() {
  await requirePlace({ domain: 'business' });
  const counts = await openCounts();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="עסקים" subtitle={<><bdi>a-digital</bdi> ו-<bdi>Head Spa Israel</bdi></>} />
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ENTITIES.filter(e => e.domain === 'business').map(e => {
          const c = counts[`business/${e.id}`];
          const locs = LOCATIONS.filter(l => l.entity === e.id);
          return (
            <li key={e.id}>
              <Card className="flex h-full flex-col gap-4 p-5 sm:p-6">
                <div className="flex flex-col gap-1">
                  <Link href={e.href} className="inline-flex items-center gap-1 text-card font-semibold text-ink hover:underline">
                    <bdi>{e.label}</bdi><ChevronLeft className="size-4 text-muted" aria-hidden />
                  </Link>
                  <p className="text-sm text-muted">
                    {c?.open ? <>{c.open} משימות פתוחות{c.overdue ? <> · <span className="text-critical-ink">{c.overdue} באיחור</span></> : null}</> : 'אין משימות פתוחות'}
                  </p>
                </div>
                {locs.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {locs.map(l => (
                      <li key={l.id}>
                        <Link href={`${e.href}/${l.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-ink transition-colors hover:bg-surface-2">
                          <MapPin className="size-4 text-muted" aria-hidden />{l.label}
                          {l.status === 'setup' && <Badge tone="warning">בהקמה</Badge>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
