'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { RefreshCw, Unplug } from 'lucide-react';
import { disconnectGmail, syncGmailNow, type GmailSyncResult } from '@/app/gmail-actions';
import { Button, buttonClass } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// "סנכרן עכשיו" + the result (with a link to the review screen) and "נתק" with a confirm
export function GmailControls({ alsoCalendar }: { alsoCalendar: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<GmailSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sync = () => start(async () => {
    setError(null);
    setResult(await syncGmailNow());
  });
  const cut = () => {
    const text = alsoCalendar
      ? 'לנתק את חשבון Google? ההרשאה ל-Gmail וליומן Google מבוטלת יחד (זו אותה הרשאה), והיומן יפסיק להתעדכן. מה שכבר ייבאת נשאר.'
      : 'לנתק את חשבון Google? ההרשאה ל-Gmail מבוטלת. מה שכבר ייבאת נשאר.';
    if (!confirm(text)) return;
    start(async () => {
      const r = await disconnectGmail();
      if (!r.ok) setError(r.error);
    });
  };
  const reviewable = result?.ok ? result.added - result.rejected : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={pending} onClick={sync}>
          <RefreshCw className={cn('size-4', pending && 'animate-spin')} aria-hidden />{pending ? 'סורק…' : 'סנכרן עכשיו'}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={cut}>
          <Unplug className="size-4" aria-hidden />נתק
        </Button>
      </div>
      {result?.ok && (
        <div role="status" className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
          <span>
            {reviewable === 0 ? 'לא נמצאו חשבוניות או קבלות חדשות לסקירה.' : reviewable === 1 ? 'נמצא פריט חדש אחד לסקירה.' : `נמצאו ${reviewable} פריטים חדשים לסקירה.`}
            {result.rejected > 0 && ` ${result.rejected} הודעות לא רלוונטיות סוננו.`}
            {result.failed > 0 && ` ${result.failed} הודעות לא נקראו.`}
            {result.more && ' יש עוד הודעות: סנכרן שוב בעוד כמה דקות.'}
          </span>
          {reviewable > 0 && (
            <Link href={`/finance-import?import=${result.importId}`} className={buttonClass('secondary', 'sm')}>לסקירה</Link>
          )}
        </div>
      )}
      {result && !result.ok && <p role="alert" className="text-sm text-critical-ink">{result.error}</p>}
      {error && <p role="alert" className="text-sm text-critical-ink">{error}</p>}
    </div>
  );
}
