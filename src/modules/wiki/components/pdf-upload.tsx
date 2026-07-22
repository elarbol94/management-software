"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileUp, Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type UploadItem = { name: string; progress: number; state: "uploading" | "done" | "error"; error?: string };

function uploadPdf(file: File, sourceId: string | undefined, onProgress: (progress: number) => void) {
  return new Promise<{ sourceId: string; documentId: string; duplicate: boolean }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/wiki/pdf-documents${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`);
    request.setRequestHeader("Content-Type", "application/pdf");
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onload = () => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(request.responseText) as Record<string, unknown>; } catch { /* handled below */ }
      if (request.status >= 200 && request.status < 300) resolve(body as never);
      else reject(new Error(String(body.error || "Upload failed")));
    };
    request.onerror = () => reject(new Error("Upload failed"));
    request.send(file);
  });
}

export function PdfUpload({ sourceId, dropzone = false }: { sourceId?: string; dropzone?: boolean }) {
  const t = useTranslations("wiki");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  async function addFiles(files: File[]) {
    const pdfs = files.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) return;
    setUploads(pdfs.map((file) => ({ name: file.name, progress: 0, state: "uploading" })));
    let lastSourceId = sourceId;
    for (let index = 0; index < pdfs.length; index += 1) {
      const file = pdfs[index];
      try {
        const result = await uploadPdf(file, sourceId, (progress) => setUploads((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, progress } : item)));
        lastSourceId = result.sourceId;
        setUploads((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, progress: 100, state: "done" } : item));
      } catch (error) {
        setUploads((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, state: "error", error: error instanceof Error ? error.message : t("pdfUploadFailed") } : item));
      }
    }
    router.refresh();
    if (!sourceId && pdfs.length === 1 && lastSourceId) router.push(`/wiki/sources/${lastSourceId}`);
  }

  const busy = uploads.some((upload) => upload.state === "uploading");
  const chooser = <input ref={input} hidden type="file" accept="application/pdf,.pdf" multiple onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />;

  if (!dropzone) return <div className="space-y-2">{chooser}<Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}{t("addPdf")}</Button><UploadProgress uploads={uploads} /></div>;

  return <section
    className={cn("rounded-xl border-2 border-dashed p-5 transition-colors", dragging ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20" : "border-border bg-muted/20")}
    onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
    onDragOver={(event) => event.preventDefault()}
    onDragLeave={() => setDragging(false)}
    onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(Array.from(event.dataTransfer.files)); }}
  >{chooser}<div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:text-left"><span className="grid size-11 place-items-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"><UploadCloud className="size-5" /></span><div className="flex-1"><h2 className="font-medium">{t("pdfDropTitle")}</h2><p className="text-sm text-muted-foreground">{t("pdfDropDescription")}</p></div><Button type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}{t("choosePdfs")}</Button></div><UploadProgress uploads={uploads} /></section>;
}

function UploadProgress({ uploads }: { uploads: UploadItem[] }) {
  if (!uploads.length) return null;
  return <div className="mt-3 space-y-2">{uploads.map((upload) => <div key={upload.name} className="rounded-md border bg-background p-2 text-xs"><div className="flex justify-between gap-3"><span className="truncate font-medium">{upload.name}</span><span className={upload.state === "error" ? "text-destructive" : "text-muted-foreground"}>{upload.state === "error" ? upload.error : `${upload.progress}%`}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded bg-muted"><div className={cn("h-full bg-indigo-500 transition-all", upload.state === "error" && "bg-destructive")} style={{ width: `${upload.progress}%` }} /></div></div>)}</div>;
}
