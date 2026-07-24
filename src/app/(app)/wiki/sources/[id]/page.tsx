import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, History, Link2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getSourceById, listDocumentTypes } from "@/modules/wiki/research-queries";
import { listAttachmentsFor } from "@/lib/files";
import { SourceForm } from "@/modules/wiki/components/source-form";
import { AttachmentPanel } from "@/modules/wiki/components/attachment-panel";
import { PdfDocumentsPanel } from "@/modules/wiki/components/pdf-documents-panel";
import { SourcePageActions } from "@/modules/wiki/components/source-page-actions";
import { formatBibliographyEntry } from "@/modules/wiki/lib/citations";
import { RestoreSourceRevisionButton } from "@/modules/wiki/components/revision-actions";
import { listPdfDocumentsForSource } from "@/modules/wiki/pdf-queries";
import { sourceTitleFromFileName } from "@/modules/wiki/lib/pdf-evidence";

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(); const t = await getTranslations("wiki"); const { id } = await params; const data = getSourceById(id); if (!data) notFound();
  const attachments = listAttachmentsFor("wikiSource", id).filter((file) => file.mimeType !== "application/pdf").map((file) => ({ id: file.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes }));
  const pdfDocuments = listPdfDocumentsForSource(id); const documentTypes = listDocumentTypes().map((item) => item.value);
  const primaryPdf = pdfDocuments.find((document) => document.role === "primary") ?? pdfDocuments[0];
  let metadata: Record<string, string> = {};
  try { metadata = JSON.parse(primaryPdf?.metadataJson ?? "{}") as Record<string, string>; } catch {}
  const filenameTitle = primaryPdf ? sourceTitleFromFileName(primaryPdf.fileName) : "";
  const metadataDefaults = { title: data.source.title === filenameTitle ? metadata.suggestedTitle || data.source.title : data.source.title, issuedDate: data.source.issuedDate || metadata.suggestedIssuedDate || "", language: data.source.language || metadata.suggestedLanguage || "", doi: data.source.doi || metadata.suggestedDoi || "", isbn: data.source.isbn || metadata.suggestedIsbn || "", contributors: data.contributors.length ? data.contributors : metadata.suggestedAuthor ? [{ role: "author" as const, given: "", family: "", literal: metadata.suggestedAuthor }] : [] };
  const citation = formatBibliographyEntry({ ...data.source, contributors: data.contributors });
  return <main className="mx-auto max-w-6xl p-5 md:p-8"><Link href="/wiki/sources" className="mb-5 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{t("backToSources")}</Link>
    <header className="mb-7 border-b pb-5"><div className="flex items-start justify-between gap-4"><div><p className="mb-1 text-xs font-semibold tracking-[0.16em] text-indigo-600 uppercase">{t(`sourceTypes.${data.source.type}`)}</p><h1 className="max-w-3xl text-3xl font-semibold tracking-tight">{data.source.title}</h1></div><SourcePageActions sourceId={id} /></div><p className="mt-4 max-w-3xl border-l-2 border-indigo-300 pl-3 text-sm leading-relaxed text-muted-foreground">{citation}</p></header>
    <div className="mb-8"><PdfDocumentsPanel sourceId={id} documents={pdfDocuments} /></div>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]"><SourceForm key={id} documentTypes={documentTypes} redirectTo="/wiki/sources" initial={{ ...data.source, ...metadataDefaults, tags: data.tags }} /><aside className="space-y-6"><AttachmentPanel entityType="wikiSource" entityId={id} initial={attachments} />
      <section><h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><Link2 className="size-4 text-indigo-500" />{t("linkedPages")}</h3>{data.pages.length ? <div className="space-y-1">{data.pages.map((page) => <Link key={`${page.id}-${page.relation}`} href={`/wiki/pages/${page.slug}`} className="block rounded-md border p-2 text-sm hover:bg-accent"><span className="block font-medium">{page.title}</span><span className="text-[11px] text-muted-foreground">{t(page.relation === "citation" ? "citedIn" : "supportingSource")}</span></Link>)}</div> : <p className="text-xs text-muted-foreground">{t("notLinkedYet")}</p>}</section>
      <section><h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><History className="size-4 text-indigo-500" />{t("history")}</h3><div className="space-y-2">{data.revisions.length ? data.revisions.map((revision) => <div key={revision.id} className="flex items-start justify-between gap-1 text-xs text-muted-foreground"><span><span className="font-medium text-foreground">v{revision.version}</span> · {revision.createdByName}<br />{revision.createdAt.toLocaleString()}</span><RestoreSourceRevisionButton revisionId={revision.id} /></div>) : <p className="text-xs text-muted-foreground">{t("noHistory")}</p>}</div></section>
    </aside></div>
  </main>;
}
