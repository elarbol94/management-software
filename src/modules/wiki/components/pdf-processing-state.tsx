"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { retryPdfProcessing } from "../pdf-actions";

export function PdfProcessingState({ sourceId, documentId, status, pageCount, progressPage, error }: { sourceId: string; documentId: string; status: string; pageCount: number; progressPage: number; error: string }) {
  const t = useTranslations("wiki"); const router = useRouter();
  useEffect(() => { if (status === "ready" || status === "failed") return; const timer = setInterval(() => router.refresh(), 2500); return () => clearInterval(timer); }, [router, status]);
  return <main className="grid min-h-[70vh] place-items-center p-6 text-center"><div className="max-w-md rounded-xl border bg-card p-8 shadow-sm">{status === "failed" ? <AlertCircle className="mx-auto size-9 text-destructive" /> : <Loader2 className="mx-auto size-9 animate-spin text-indigo-500" />}<h1 className="mt-4 text-xl font-semibold">{t(`pdfStatuses.${status}`)}</h1>{pageCount > 0 && <p className="mt-2 text-sm text-muted-foreground">{progressPage}/{pageCount}</p>}{error && <p className="mt-3 rounded bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}<div className="mt-5 flex justify-center gap-2"><Link className={buttonVariants({ variant: "outline" })} href={"/wiki/sources/" + sourceId}>{t("backToSource")}</Link>{status === "failed" && <Button onClick={async () => { await retryPdfProcessing(documentId); router.refresh(); }}><RefreshCw className="size-4" />{t("retry")}</Button>}</div></div></main>;
}
