import { requireUser } from "@/lib/auth";
import { getResearchNavigation } from "@/modules/wiki/research-queries";
import { ResearchSidebar } from "@/modules/wiki/components/research-sidebar";

export default async function WikiLayout({ children }: { children: React.ReactNode }) {
  const currentUser = await requireUser();
  const navigation = getResearchNavigation(currentUser.id);
  return (
    <div className="-m-6 flex min-h-[calc(100vh-0px)] flex-col md:flex-row">
      <ResearchSidebar {...navigation} />
      <section className="min-w-0 flex-1 overflow-x-hidden">{children}</section>
    </div>
  );
}
