import Link from 'next/link';
import { Filter, History } from 'lucide-react';
import { requireUser } from '@/server/auth';
import { activityFeed, activityUsers } from '@/server/activity';
import { Card, CardContent } from '@/components/ui/card';
import { Button, buttonClass } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { DateField } from '@/components/ui/date-field';
import { PageHeader } from '@/components/shell/page-header';
import { labelClass, selectClass } from '@/components/work/fields';
import { cn } from '@/lib/utils';
import { ActivityList } from '@/components/activity/activity-list';
import { OBJECT_TYPES } from '@/lib/activity';
import { contextLabel, decodePlace, encodePlace } from '@/lib/places';

export const metadata = { title: 'יומן פעילות — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: string | undefined) => (v && DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const ID = /^[A-Za-z0-9:_-]{1,80}$/;

// Activity log (3.6): every significant action — who, when, which object, what. Owner/admin see
// everyone; other users see their own actions. Filters: who, object type, dates; "עוד" pages back.
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const type = OBJECT_TYPES.some(t => t.id === sp.type) ? sp.type! : null;
  const object = type && sp.object && ID.test(sp.object) ? sp.object : null;
  const place = sp.place ? decodePlace(sp.place) : null;
  const users = u.isAdmin ? await activityUsers() : [];
  const who = u.isAdmin && users.some(x => x.id === sp.who) ? sp.who! : null;
  const from = date(sp.from), to = date(sp.to);
  const before = Number(sp.before) > 0 ? Math.floor(Number(sp.before)) : null;
  const { ready, items, next } = await activityFeed(u, { objectType: type, objectId: object, place, userId: who, from, to, before, limit: 50 });
  const keep = Object.entries({ type, object, place: place ? encodePlace(place) : null, who, from, to }).filter(([, v]) => v) as [string, string][];
  const nextHref = next ? `/activity?${new URLSearchParams([...keep, ['before', String(next)]])}` : null;
  const filtered = keep.length > 0;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="יומן פעילות" subtitle={u.isAdmin ? 'כל הפעולות במערכת: מי, מתי, על מה ומה נעשה.' : 'הפעולות שלך במערכת.'} />
      <Card><CardContent className="pt-5 sm:pt-6">
      <form action="/activity" aria-label="סינון פעילות" className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-5">
        {object && <input type="hidden" name="object" value={object} />}
        {place && <input type="hidden" name="place" value={encodePlace(place)} />}
        {u.isAdmin && (
          <label className={cn(labelClass, 'flex flex-col gap-1.5')}>מי
            <select name="who" defaultValue={who ?? ''} className={selectClass}>
              <option value="">כולם</option>
              {users.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}
        <label className={cn(labelClass, 'flex flex-col gap-1.5')}>סוג
          <select name="type" defaultValue={type ?? ''} className={selectClass}>
            <option value="">הכול</option>
            {OBJECT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="act-from" className={labelClass}>מתאריך</label>
          <DateField id="act-from" name="from" defaultValue={from ?? ''} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="act-to" className={labelClass}>עד תאריך</label>
          <DateField id="act-to" name="to" defaultValue={to ?? ''} />
        </div>
        <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
          <Button type="submit" variant="secondary" size="lg"><Filter aria-hidden />סנן</Button>
          {filtered && <Link href="/activity" className={buttonClass('ghost', 'lg')}>נקה</Link>}
        </div>
      </form>
      </CardContent></Card>
      {(place || object) && (
        <p className="text-sm text-ink-2">
          מסונן ל{place ? <> <bdi dir="rtl">{contextLabel(place)}</bdi></> : ' אובייקט אחד'}
        </p>
      )}
      <Card>
        <CardContent className="pt-3 sm:pt-4">
          {!ready || items.length === 0
            ? <Empty compact icon={<History aria-hidden />} title={filtered || before ? 'אין פעילות לסינון הזה' : 'אין נתונים עדיין'} />
            : <ActivityList items={items} />}
          <div className="flex items-center gap-2 pt-3 empty:hidden">
            {nextHref && <Link href={nextHref} className={buttonClass('secondary', 'sm')}>עוד</Link>}
            {before && <Link href={`/activity${keep.length ? `?${new URLSearchParams(keep)}` : ''}`} className={buttonClass('ghost', 'sm')}>לחדשים ביותר</Link>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
