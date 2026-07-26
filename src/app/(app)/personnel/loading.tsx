import { Skeleton } from "@/components/ui/skeleton";

export default function PersonnelLoading() {
  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <Skeleton className="h-28 w-full rounded-2xl" />
      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <Skeleton className="h-[34rem] rounded-2xl" />
        <Skeleton className="h-[34rem] rounded-2xl" />
      </div>
    </div>
  );
}
