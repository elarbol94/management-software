import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { listWorkspacePages } from "@/modules/wiki/research-queries";
import { QuickNoteButton } from "@/modules/wiki/components/workspace-actions";
import { WorkspacePageList } from "@/modules/wiki/components/workspace-page-list";

export default async function InboxPage() {
  const currentUser = await requireUser();
  const t = await getTranslations("wiki");
  const pages = listWorkspacePages(currentUser.id);
  return (
    <main className="mx-auto max-w-5xl p-5 md:p-8">
      <header className="mb-7 flex items-end justify-between gap-4 border-b pb-5">
        <div>
          <p className="mb-1 text-xs font-semibold tracking-[0.16em] text-indigo-600 uppercase">
            {t("captureAndTriage")}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("notesWorkspace")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("notesWorkspaceDescription")}
          </p>
        </div>
        <QuickNoteButton />
      </header>
      <WorkspacePageList pages={pages} />
    </main>
  );
}
