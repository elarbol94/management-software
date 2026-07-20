import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BookMarked, FileCheck2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listSources } from "@/modules/wiki/research-queries";
import { NewSourceDialog } from "@/modules/wiki/components/new-source-dialog";
import { SourceFilters } from "@/modules/wiki/components/source-filters";
import { LibraryTools } from "@/modules/wiki/components/library-tools";
import { MetadataLookupDialog } from "@/modules/wiki/components/metadata-lookup-dialog";

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await requireUser(); const t = await getTranslations("wiki"); const params = await searchParams;
  const sources = listSources({ query: params.q, status: params.status });
  return <main className="p-5 md:p-8"><header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-5"><div><p className="mb-1 text-xs font-semibold tracking-[0.16em] text-indigo-600 uppercase">{t("evidenceLibrary")}</p><h1 className="text-3xl font-semibold tracking-tight">{t("sources")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("sourcesDescription")}</p></div><div className="flex flex-wrap gap-2"><MetadataLookupDialog /><NewSourceDialog /></div></header>
    <div className="mb-4"><LibraryTools /></div>
    <SourceFilters initialQuery={params.q ?? ""} initialStatus={params.status ?? ""} />
    {sources.length === 0 ? <div className="mt-6 grid min-h-64 place-items-center rounded-xl border border-dashed bg-muted/20 text-center"><div><BookMarked className="mx-auto mb-3 size-8 text-indigo-400" /><h2 className="font-medium">{t("noSources")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("noSourcesDescription")}</p></div></div> :
    <div className="mt-4 overflow-x-auto rounded-xl border"><table className="w-full min-w-[850px] text-sm"><thead className="bg-muted/50 text-left text-[11px] tracking-wider text-muted-foreground uppercase"><tr><th className="px-3 py-2">{t("sourceTitle")}</th><th className="px-3 py-2">{t("contributors")}</th><th className="px-3 py-2">{t("year")}</th><th className="px-3 py-2">{t("sourceType")}</th><th className="px-3 py-2">{t("readingStatus")}</th><th className="px-3 py-2 text-right">{t("evidence")}</th></tr></thead><tbody className="divide-y">{sources.map((source) => <tr key={source.id} className="group hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20"><td className="max-w-sm px-3 py-3"><Link href={`/wiki/sources/${source.id}`} className="font-medium group-hover:text-indigo-700 dark:group-hover:text-indigo-300">{source.title}</Link>{source.tags && <p className="mt-1 truncate text-[11px] text-muted-foreground">{source.tags}</p>}</td><td className="max-w-xs truncate px-3 py-3 text-muted-foreground">{source.contributors || "—"}</td><td className="px-3 py-3 tabular-nums text-muted-foreground">{source.issuedDate.slice(0,4) || "—"}</td><td className="px-3 py-3 text-muted-foreground">{t(`sourceTypes.${source.type}`)}</td><td className="px-3 py-3"><span className="rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">{t(`readingStatuses.${source.readingStatus}`)}</span></td><td className="px-3 py-3 text-right text-xs text-muted-foreground"><span title={t("citations")} className="inline-flex items-center gap-1"><BookMarked className="size-3.5" />{source.citationCount}</span><span title={t("attachments")} className="ml-3 inline-flex items-center gap-1"><FileCheck2 className="size-3.5" />{source.attachmentCount}</span></td></tr>)}</tbody></table></div>}
  </main>;
}
