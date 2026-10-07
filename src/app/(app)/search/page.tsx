import Link from 'next/link';
import { Search } from 'lucide-react';
import { search } from '@/server/entries';
import { stamp } from '@/lib/format';
import { TaskRow } from '@/components/work/task-row';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/work/fields';

export const metadata = { title: 'חיפוש — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = ((await searchParams).q ?? '').trim().slice(0, 100);
  const r = q.length >= 2 ? await search(q) : null;
  const total = r ? r.tasks.length + r.vault.length + r.inbox.length + r.events.length : 0;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold">חיפוש</h1>
      <form action="/search" className="flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">חיפוש</label>
        <input id="q" name="q" defaultValue={q} autoFocus placeholder="משימה, פגישה, פריט ב-Inbox…" className={`${inputClass} h-10`} />
        <Button type="submit" variant="primary" className="h-10"><Search className="size-4" aria-hidden />חפש</Button>
      </form>
      {r && total === 0 && <p className="text-sm text-muted">לא נמצא שום דבר עבור "<bdi>{q}</bdi>".</p>}
      {r && r.tasks.length + r.vault.length > 0 && (
        <Card>
          <CardHeader><CardTitle>משימות</CardTitle><span className="text-sm text-muted">{r.tasks.length + r.vault.length}</span></CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {r.tasks.map(t => <TaskRow key={t.id} item={t} path="/search" />)}
              {r.vault.map(t => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <bdi>{t.text}</bdi><span className="flex gap-1.5"><Badge tone="accent"><bdi dir="rtl">{t.context}</bdi></Badge><Badge>מהוואלט</Badge></span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {r && r.events.length > 0 && (
        <Card>
          <CardHeader><CardTitle>אירועים</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-[color:var(--border)] text-sm">
              {r.events.map(e => <li key={e.id} className="flex justify-between gap-3 py-2"><bdi>{e.title}</bdi><span className="text-muted">{stamp(e.start_at)}</span></li>)}
            </ul>
          </CardContent>
        </Card>
      )}
      {r && r.inbox.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Inbox</CardTitle><Link href="/inbox" className="text-sm text-accent hover:underline">ל-Inbox</Link></CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-[color:var(--border)] text-sm">
              {r.inbox.map(i => <li key={i.id} className="flex justify-between gap-3 py-2"><bdi className="truncate">{i.text}</bdi>{i.status === 'classified' && <Badge>שויך</Badge>}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
