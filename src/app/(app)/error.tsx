'use client';
import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

// Error state for a page whose data failed to load (spec §116)
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <CircleAlert className="size-7 text-critical" aria-hidden />
        <p className="font-medium">הנתונים לא נטענו</p>
        <p className="max-w-md text-sm text-muted">אין כרגע תשובה מהשרת או ממסד הנתונים. אף נתון לא נפגע.</p>
        <Button variant="primary" onClick={reset}>לנסות שוב</Button>
      </CardContent>
    </Card>
  );
}
