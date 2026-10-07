import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Skeletons, never a blank screen (spec §91)
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <Card key={i} className="p-5">
            <Skeleton className="w-28" />
            <Skeleton className="mt-3 h-7 w-32" />
          </Card>
        ))}
      </div>
      <Card className="p-5"><Skeleton className="w-40" /><Skeleton className="mt-4 h-40" /></Card>
    </div>
  );
}
