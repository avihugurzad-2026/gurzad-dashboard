import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonClass } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/page-header';

// A planned area (spec §4) that is not built yet: say so plainly instead of showing an empty screen.
export function Soon({ title, lead, items, note }: { title: string; lead: string; items: string[]; note?: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} subtitle={lead} />
      <Card>
        <CardHeader><CardTitle>מה מתוכנן כאן</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex list-inside list-disc flex-col gap-1.5 text-body text-ink-2">
            {items.map(x => <li key={x}><bdi>{x}</bdi></li>)}
          </ul>
          {note && <p className="text-sm text-muted">{note}</p>}
          <div><Link href="/" className={buttonClass('secondary', 'sm')}>חזרה לסקירה</Link></div>
        </CardContent>
      </Card>
    </div>
  );
}
