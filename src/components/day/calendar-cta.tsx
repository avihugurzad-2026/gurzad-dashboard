import Link from 'next/link';
import { CalendarPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

// Shown where calendar events would be, until Google Calendar is connected
export function CalendarCta({ configured, className }: { configured: boolean; className?: string }) {
  return (
    <p className={cn('flex items-start gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2 text-sm text-muted', className)}>
      <CalendarPlus className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {configured ? 'יומן Google עוד לא מחובר, אז מוצגות רק משימות. ' : 'החיבור ליומן Google עוד לא הוגדר, אז מוצגות רק משימות. '}
        <Link href="/settings#calendar" className="font-medium text-accent hover:underline">{configured ? 'לחבר את היומן' : 'מה צריך לעשות'}</Link>
      </span>
    </p>
  );
}
