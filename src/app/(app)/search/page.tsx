import Link from 'next/link';
import { Search } from 'lucide-react';
import { requireUser } from '@/server/auth';
import { globalSearch } from '@/server/search';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/work/fields';
import { TypeIcon } from '@/components/search/type-icon';

export const metadata = { title: 'חיפוש — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

// Full results of the global search (3.5). The ⌘K palette shows the top few of each group; this
// page shows up to 20 per group.
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser();
  const q = ((await searchParams).q ?? '').trim().slice(0, 100);
  const r = q.length >= 2 ? await globalSearch(u, q, 20) : null;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-page font-bold">חיפוש</h1>
      <form action="/search" className="flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">חיפוש</label>
        <input id="q" name="q" type="search" defaultValue={q} autoFocus placeholder="משימה, לקוח, מסמך, נכס, יעד…" className={`${inputClass} h-10`} />
        <Button type="submit" variant="primary" className="h-10"><Search className="size-4" aria-hidden />חפש</Button>
      </form>
      {!r && <p className="text-sm text-muted">הקלד לפחות שני תווים. טיפ: <kbd className="rounded border border-line-strong px-1 text-xs" dir="ltr">⌘K</kbd> או <kbd className="rounded border border-line-strong px-1 text-xs">/</kbd> פותחים חיפוש מכל מסך.</p>}
      {r && r.total === 0 && <p className="text-sm text-muted">לא נמצא שום דבר עבור "<bdi>{q}</bdi>".</p>}
      {r && r.groups.map(g => (
        <Card key={g.type}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TypeIcon type={g.type} className="size-4 text-muted" />{g.label}</CardTitle>
            <span className="text-sm text-muted">{g.items.length}</span>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {g.items.map(i => (
                <li key={i.id}>
                  <Link href={i.href} className="flex flex-col gap-0.5 rounded-md px-1 py-2 hover:bg-surface-2">
                    <span className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-ink">
                      <bdi>{i.title}</bdi>
                      {i.subtitle && <span className="text-xs font-normal text-muted"><bdi>{i.subtitle}</bdi></span>}
                    </span>
                    <span className="text-xs text-muted"><bdi dir="rtl">{i.crumbs}</bdi></span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
