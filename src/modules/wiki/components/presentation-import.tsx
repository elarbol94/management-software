"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PptxImportWarning } from "../lib/presentation-pptx";

export function PresentationImport() {
  const t = useTranslations("presentationStudio"), router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; warnings: PptxImportWarning[] } | null>(null);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch("/api/wiki/presentations/import", { method: "POST", body });
      if (!response.ok) throw new Error("Import failed");
      setResult(await response.json());
    } catch { toast.error(t("importFailed")); } finally { setBusy(false); }
  };
  return <><Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>{t("importPptx")}</Button><Dialog open={open} onOpenChange={(open) => { if (!busy) setOpen(open); }}><DialogContent><DialogHeader><DialogTitle>{t("importPptx")}</DialogTitle><DialogDescription>{t("importHint")}</DialogDescription></DialogHeader>
    {!result ? <label className="space-y-2 text-sm">{busy ? t("importing") : t("choosePptx")}<input type="file" className="block w-full" accept=".pptx" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /></label> : <div className="space-y-3"><h3 className="font-medium">{t("importWarnings")}</h3><ul className="max-h-72 list-disc overflow-auto pl-5 text-sm">{result.warnings.map((warning, i) => <li key={i}>{t(`pptxWarnings.${warning.code}`, { slide: warning.slide })}</li>)}{!result.warnings.length && <li>{t("pptxWarnings.none")}</li>}</ul><Button type="button" onClick={() => { router.push(`/wiki/presentations/${result.id}`); setOpen(false); setResult(null); }}>{t("openImported")}</Button></div>}
  </DialogContent></Dialog></>;
}
