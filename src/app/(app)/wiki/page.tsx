import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, Clock3, FileText, LibraryBig } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getKnowledgeLaunchpad, listDocumentTypes } from "@/modules/wiki/research-queries";
import { KnowledgeSearch } from "@/modules/wiki/components/knowledge-search";
import { QuickNoteButton } from "@/modules/wiki/components/workspace-actions";
import { NewSourceDialog } from "@/modules/wiki/components/new-source-dialog";

export default async function WikiIndex() {
  const [, t, locale] = await Promise.all([
    requireUser(),
    getTranslations("wiki"),
    getLocale(),
  ]);
  const launchpad = getKnowledgeLaunchpad();
  const documentTypes = listDocumentTypes().map((item) => item.value);
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <main className="mx-auto w-full max-w-6xl p-5 md:p-8 lg:py-12">
      <header className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-semibold tracking-[0.18em] text-indigo-600 uppercase">{t("knowledgeLaunchpad")}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{t("launchpadTitle")}</h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">{t("launchpadDescription")}</p>
      </header>

      <section className="mx-auto mt-8 max-w-3xl" aria-label={t("knowledgeSearch")}>
        <KnowledgeSearch />
        <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
          <QuickNoteButton label={t("writeDocument")} />
          <NewSourceDialog documentTypes={documentTypes} label={t("addSource")} />
        </div>
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold"><FileText className="size-4 text-indigo-500" />{t("continueWorking")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("continueWorkingDescription")}</p>
            </div>
            <Link href="/wiki/pages" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">{t("showAllDocuments")}<ArrowRight className="size-3" /></Link>
          </div>
          {launchpad.documents.length ? (
            <div className="divide-y rounded-xl border">
              {launchpad.documents.map((item) => (
                <Link key={item.id} href={item.href} className="group flex items-center gap-3 p-3 hover:bg-accent">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300"><FileText className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium group-hover:text-indigo-700 dark:group-hover:text-indigo-300">{item.title}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 className="size-3" />{t("editedOn", { date: formatter.format(new Date(item.updatedAt)) })}</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("noRecentDocuments")}</p>}
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold"><LibraryBig className="size-4 text-emerald-600" />{t("recentlyRead")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("recentlyReadDescription")}</p>
            </div>
            <Link href="/wiki/sources" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">{t("showAllSources")}<ArrowRight className="size-3" /></Link>
          </div>
          {launchpad.sources.length ? (
            <div className="divide-y rounded-xl border">
              {launchpad.sources.map((item) => (
                <Link key={item.id} href={item.href} className="group flex items-center gap-3 p-3 hover:bg-accent">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><LibraryBig className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium group-hover:text-indigo-700 dark:group-hover:text-indigo-300">{item.title}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">{t(`readingStatuses.${item.status}`)} · {formatter.format(new Date(item.updatedAt))}</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("noRecentlyReadSources")}</p>}
        </section>
      </div>
    </main>
  );
}
