import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { listWorkspacePages } from "@/modules/wiki/research-queries";
import { QuickNoteButton } from "@/modules/wiki/components/workspace-actions";
import { PageTreeList } from "@/modules/wiki/components/page-tree-list";

export default async function PagesIndex() {
  const currentUser = await requireUser();
  const t = await getTranslations("wiki");
  const pages = listWorkspacePages(currentUser.id);
  return <div className="mx-auto max-w-5xl p-5 md:p-8">
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b pb-5">
      <div>
        <p className="mb-1 text-xs font-semibold tracking-[0.16em] text-indigo-600 uppercase">{t("knowledgeBase")}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{t("documents")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("documentsDescription")}</p>
      </div>
      <QuickNoteButton />
    </header>
    <PageTreeList pages={pages} />
  </div>;
}
