import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <p className="text-sm text-muted">404</p>
        <h1 className="mt-1 text-page font-bold">הדף לא קיים</h1>
        <Link href="/" className="mt-3 inline-block text-sm font-medium text-accent hover:underline">חזרה לסקירה</Link>
      </div>
    </main>
  );
}
