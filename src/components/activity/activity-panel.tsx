import Link from 'next/link';
import { History } from 'lucide-react';
import { requireUser } from '@/server/auth';
import { activityFeed } from '@/server/activity';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { encodePlace, type Place } from '@/lib/places';
import { ActivityList } from './activity-list';

// Recent activity of one object or one place, for entity/branch/object profile pages.
//   <ActivityPanel place={{ domain: 'business', branch: 'head-spa-israel', location: 'modiin' }} />
//   <ActivityPanel objectType="asset" objectId={id} />   (also shows tasks/documents filed against it)
// Owner/admin see everyone's actions; other users see their own.
export async function ActivityPanel({ objectType, objectId, place, title = 'פעילות אחרונה', limit = 10 }: {
  objectType?: string; objectId?: string; place?: Partial<Place> | null; title?: string; limit?: number;
}) {
  const u = await requireUser();
  const { ready, items, next } = await activityFeed(u, { objectType, objectId, place, limit });
  const qs = new URLSearchParams();
  if (objectType) qs.set('type', objectType);
  if (objectId) qs.set('object', objectId);
  if (place?.domain) qs.set('place', encodePlace({ domain: place.domain, branch: place.branch ?? null, location: place.location ?? null }));
  const all = `/activity${qs.size ? `?${qs}` : ''}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><History className="size-4 text-muted" aria-hidden />{title}</CardTitle>
        {items.length > 0 && <Link href={all} className="text-sm text-accent hover:underline">כל הפעילות</Link>}
      </CardHeader>
      <CardContent>
        {!ready || items.length === 0
          ? <p className="text-sm text-muted">אין נתונים עדיין</p>
          : <>
              <ActivityList items={items} showContext={!place?.location && !objectId} />
              {next && <Link href={all} className="mt-1 inline-block text-sm text-accent hover:underline">עוד</Link>}
            </>}
      </CardContent>
    </Card>
  );
}
