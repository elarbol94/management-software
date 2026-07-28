import { Skeleton } from "@/components/ui/skeleton";

export default function CalendarLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[112rem] flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-56" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="grid min-h-[42rem] gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <Skeleton className="hidden rounded-2xl lg:block" />
        <Skeleton className="rounded-2xl" />
      </div>
    </div>
  );
}

