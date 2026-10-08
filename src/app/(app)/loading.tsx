import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Skeletons, never a blank screen (spec §91)
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="טוען">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <Card key={i} className="p-5 sm:p-6">
            <Skeleton className="w-28" />
            <Skeleton className="mt-3 h-9 w-32" />
          </Card>
        ))}
      </div>
      <Card className="p-5 sm:p-6"><Skeleton className="h-5 w-40" /><Skeleton className="mt-5 h-40" /></Card>
    </div>
  );
}
