import { Skeleton } from "@/components/ui/skeleton";

export default function DocumentsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.75fr)]">
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    </div>
  );
}
