import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { Skeleton } from "@/components/ui/skeleton";

export const unstable_instant = {
  prefetch: "runtime",
  samples: [
    {
      cookies: [{ name: "locale", value: "de" }],
      headers: [["rsc", "1"], ["next-action", null]],
      params: { slug: "sample", id: "sample", projectId: "sample", documentId: "sample", page: "1" },
    },
  ],
};

async function AuthenticatedSidebar() {
  const user = await requireUser();
  return <AppSidebar userName={user.name} userEmail={user.email} />;
}

function SidebarFallback() {
  return (
    <>
      <header className="flex h-14 items-center gap-3 border-b px-3 md:hidden">
        <Skeleton className="size-8" />
        <Skeleton className="h-4 w-36" />
      </header>
      <aside className="hidden w-14 shrink-0 border-r md:block">
        <div className="space-y-3 p-2 pt-16">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="size-10 rounded-md" />
          ))}
        </div>
      </aside>
    </>
  );
}

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <Suspense fallback={<SidebarFallback />}>
        <AuthenticatedSidebar />
      </Suspense>
      <main className="min-w-0 flex-1 overflow-x-hidden p-6">{children}</main>
    </div>
  );
}
