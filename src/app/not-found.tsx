import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm font-medium text-muted tabular">404</p>
        <h1 className="text-title font-bold text-ink">הדף לא קיים</h1>
        <p className="text-body text-muted">ייתכן שהקישור ישן או שהדף הועבר.</p>
        <Link href="/" className={buttonClass('primary', 'md', 'mt-4')}>חזרה לסקירה</Link>
      </div>
    </main>
  );
}
