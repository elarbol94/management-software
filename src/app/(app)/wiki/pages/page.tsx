import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { listWorkspacePages } from "@/modules/wiki/research-queries";
import { QuickNoteButton } from "@/modules/wiki/components/workspace-actions";
import { PageTreeList } from "@/modules/wiki/components/page-tree-list";

export default async function PagesIndex() {
  const currentUser = await requireUser();
  const t = await getTranslations("wiki");
  const pages = listWorkspacePages(currentUser.id);
  return <div className="mx-auto max-w-7xl px-5 py-8 md:px-10 md:py-10">
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("documents")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("documentsDescription")}</p>
      </div>
      <QuickNoteButton label={t("presentations.new")} />
    </header>
    <PageTreeList pages={pages} />
  </div>;
}
