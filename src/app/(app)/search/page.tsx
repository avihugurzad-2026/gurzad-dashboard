import Link from 'next/link';
import { ChevronLeft, Search, SearchX } from 'lucide-react';
import { requireUser } from '@/server/auth';
import { globalSearch } from '@/server/search';
import { Card, Section } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { inputClass } from '@/components/work/fields';
import { TypeIcon } from '@/components/search/type-icon';
import { PageHeader } from '@/components/shell/page-header';
import { cn } from '@/lib/utils';

export const metadata = { title: 'חיפוש — דשבורד גורזד' };
export const dynamic = 'force-dynamic';

const kbd = 'inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-line-strong bg-surface px-1.5 text-xs font-medium text-ink-2';

// Full results of the global search (3.5). The ⌘K palette shows the top few of each group; this
// page shows up to 20 per group.
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser();
  const q = ((await searchParams).q ?? '').trim().slice(0, 100);
  const r = q.length >= 2 ? await globalSearch(u, q, 20) : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="חיפוש" subtitle="משימות, לקוחות, מסמכים, נכסים ויעדים מכל האזורים" />
      <form action="/search" className="flex max-w-3xl gap-2" role="search">
        <label htmlFor="q" className="sr-only">חיפוש</label>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" aria-hidden />
          <input id="q" name="q" type="search" defaultValue={q} autoFocus placeholder="משימה, לקוח, מסמך, נכס, יעד…"
            className={cn(inputClass, 'ps-9 text-body')} />
        </div>
        <Button type="submit" variant="primary" size="lg">חפש</Button>
      </form>

      {!r && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
          הקלד לפחות שני תווים. טיפ: <kbd className={kbd} dir="ltr">Ctrl K</kbd> או <kbd className={kbd}>/</kbd> פותחים חיפוש מכל מסך.
        </p>
      )}
      {r && r.total === 0 && (
        <Card><Empty icon={<SearchX aria-hidden />} title="לא נמצאו תוצאות">לא נמצא שום דבר עבור &quot;<bdi>{q}</bdi>&quot;. נסה מילה אחרת או חלק מהשם.</Empty></Card>
      )}
      {r && r.total > 0 && (
        <p className="text-sm text-muted"><span className="tabular">{r.total}</span> תוצאות עבור &quot;<bdi className="font-medium text-ink">{q}</bdi>&quot;</p>
      )}
      {r && r.groups.map(g => (
        <Section key={g.type}
          title={<><TypeIcon type={g.type} className="size-[18px] text-muted" />{g.label}<Badge className="tabular">{g.items.length}</Badge></>}>
          <Card className="overflow-hidden">
            <ul className="flex flex-col divide-y divide-[color:var(--border)]">
              {g.items.map(i => (
                <li key={i.id}>
                  <Link href={i.href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 sm:px-5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2 group-hover:bg-surface">
                      <TypeIcon type={g.type} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <bdi className="text-body font-medium text-ink">{i.title}</bdi>
                        {i.subtitle && <span className="text-sm text-muted"><bdi>{i.subtitle}</bdi></span>}
                      </span>
                      {i.crumbs && <span className="truncate text-xs text-muted"><bdi dir="rtl">{i.crumbs}</bdi></span>}
                    </span>
                    <ChevronLeft className="size-4 shrink-0 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      ))}
    </div>
  );
}
