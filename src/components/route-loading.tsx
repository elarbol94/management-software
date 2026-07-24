import { Skeleton } from "@/components/ui/skeleton";

export function RouteLoading({
  rows = 6,
  compact = false,
}: {
  rows?: number;
  compact?: boolean;
}) {
  return (
    <main
      className={compact ? "space-y-4 p-5 md:p-8" : "space-y-6"}
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="space-y-2">
        <Skeleton className="h-8 w-64 max-w-2/3" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-4 border-b p-4 last:border-b-0"
          >
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>
    </main>
  );
}
