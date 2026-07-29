"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, BookOpen, FileText, Loader2, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { retryPdfProcessing } from "../pdf-actions";
import { PdfUpload } from "./pdf-upload";

type PdfDocument = {
  id: string; role: "primary" | "supplementary"; version: number;
  status: "queued" | "extracting" | "ocr" | "ready" | "failed";
  pageCount: number; progressPage: number; error: string; fileName: string; sizeBytes: number; metadataJson: string;
};

export function PdfDocumentsPanel({ sourceId, documents }: { sourceId: string; documents: PdfDocument[] }) {
  const t = useTranslations("wiki"); const router = useRouter();
  const hasPending = documents.some((document) => document.status !== "ready" && document.status !== "failed");
  useEffect(() => { if (!hasPending) return; const timer = setInterval(() => router.refresh(), 2500); return () => clearInterval(timer); }, [hasPending, router]);
  return <section className="space-y-3"><div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-medium"><FileText className="size-4 text-indigo-500" />{t("pdfDocuments")}</h3><PdfUpload sourceId={sourceId} /></div>
    {!documents.length ? <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t("noPdfDocuments")}</p> : <div className="space-y-2">{documents.map((document) => <article key={document.id} className="rounded-lg border p-3"><div className="flex items-start gap-2"><FileText className="mt-0.5 size-4 text-indigo-500" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{document.fileName}</p><p className="text-[11px] text-muted-foreground">{t(document.role === "primary" ? "primaryPdf" : "supplementaryPdf")} · {(document.sizeBytes / 1024 / 1024).toFixed(1)} MB</p></div>{document.status === "ready" && <a className={buttonVariants({ size: "sm" })} href={"/wiki/sources/" + sourceId + "/read/" + document.id}><BookOpen className="size-4" />{t("readPdf")}</a>}</div>
        {document.status !== "ready" && <div className="mt-2 rounded bg-muted/50 p-2 text-xs"><p className="flex items-center gap-1.5">{document.status === "failed" ? <AlertCircle className="size-3.5 text-destructive" /> : <Loader2 className="size-3.5 animate-spin text-indigo-500" />}{t(`pdfStatuses.${document.status}`)}{document.pageCount > 0 && ` · ${document.progressPage}/${document.pageCount}`}</p>{document.error && <p className="mt-1 line-clamp-2 text-destructive">{document.error}</p>}{document.status === "failed" && <Button className="mt-2" size="xs" variant="outline" onClick={async () => { await retryPdfProcessing(document.id); router.refresh(); }}><RefreshCw className="size-3" />{t("retry")}</Button>}</div>}
        {document.status === "ready" && <MetadataSuggestions json={document.metadataJson} />}
      </article>)}</div>}
  </section>;
}

function MetadataSuggestions({ json }: { json: string }) {
  const t = useTranslations("wiki");
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(json) as Record<string, unknown>; } catch { return null; }
  const suggestions = [
    ["title", metadata.suggestedTitle],
    ["author", metadata.suggestedAuthor],
    ["date", metadata.suggestedIssuedDate],
    ["language", metadata.suggestedLanguage],
    ["doi", metadata.suggestedDoi],
    ["isbn", metadata.suggestedIsbn],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1]));
  if (!suggestions.length) return null;
  return <details className="mt-2 rounded bg-muted/40 p-2 text-xs"><summary className="cursor-pointer font-medium">{t("metadataSuggestions")}</summary><dl className="mt-2 grid gap-1">{suggestions.map(([key, value]) => <div key={key} className="grid grid-cols-[5rem_1fr] gap-2"><dt className="text-muted-foreground">{t(`metadataSuggestionFields.${key}`)}</dt><dd className="min-w-0 truncate">{value}</dd></div>)}</dl><p className="mt-2 text-[10px] text-muted-foreground">{t("metadataSuggestionsHint")}</p></details>;
}
