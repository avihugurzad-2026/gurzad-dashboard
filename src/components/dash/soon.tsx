import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';

// A planned area (spec §4) that is not built yet: say so plainly instead of showing an empty screen.
export function Soon({ title, lead, items, note }: { title: string; lead: string; items: string[]; note?: string }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-page font-bold">{title}</h1>
        <p className="text-sm text-muted">{lead}</p>
      </div>
      <Card>
        <CardContent className="pt-5">
          <p className="text-sm font-medium text-ink-2">מה מתוכנן כאן</p>
          <ul className="mt-2 flex list-inside list-disc flex-col gap-1 text-sm text-muted">
            {items.map(x => <li key={x}><bdi>{x}</bdi></li>)}
          </ul>
          {note && <p className="mt-3 text-sm text-ink-2">{note}</p>}
          <Link href="/" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">חזרה לסקירה</Link>
        </CardContent>
      </Card>
    </div>
  );
}
