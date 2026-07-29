import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getResearchNavigation } from "@/modules/wiki/research-queries";
import { ResearchSidebar } from "@/modules/wiki/components/research-sidebar";

export const unstable_instant = false;

async function AuthenticatedResearchSidebar() {
  const currentUser = await requireUser();
  const navigation = getResearchNavigation(currentUser.id);
  return <ResearchSidebar {...navigation} />;
}

export default function WikiLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rail-content-transition -m-6 flex min-h-[calc(100vh-0px)] flex-col duration-[220ms] ease-out motion-reduce:transition-none md:flex-row md:pl-[var(--research-rail-width,3.5rem)]">
      <Suspense fallback={<aside className="h-14 border-b md:h-screen md:w-64 md:border-r md:border-b-0" />}>
        <AuthenticatedResearchSidebar />
      </Suspense>
      <section className="min-w-0 flex-1 overflow-x-clip">{children}</section>
    </div>
  );
}
