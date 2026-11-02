'use client';
import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

// Error state for a page whose data failed to load (spec §116)
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="mb-1 grid size-11 place-items-center rounded-full bg-critical-soft text-critical-ink"><CircleAlert className="size-5" aria-hidden /></div>
        <p className="text-body font-semibold text-ink">הנתונים לא נטענו</p>
        <p className="max-w-md text-sm text-muted">אין כרגע תשובה מהשרת או ממסד הנתונים. אף נתון לא נפגע.</p>
        <Button variant="primary" onClick={reset} className="mt-2">לנסות שוב</Button>
      </CardContent>
    </Card>
  );
}
