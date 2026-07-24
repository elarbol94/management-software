"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, File, Loader2, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Attachment = { id: string; fileName: string; mimeType: string; sizeBytes: number };
export type AttachmentPanelHandle = { openFilePicker: () => void };
export const AttachmentPanel = forwardRef<AttachmentPanelHandle, { entityType: "wikiPage" | "wikiSource"; entityId: string; initial: Attachment[] }>(function AttachmentPanel({ entityType, entityId, initial }, ref) {
  const t = useTranslations("wiki"); const input = useRef<HTMLInputElement>(null); const [files, setFiles] = useState(initial); const [pending, setPending] = useState(false); const [error, setError] = useState("");
  useImperativeHandle(ref, () => ({ openFilePicker: () => input.current?.click() }), []);
  useEffect(() => { setFiles(initial); }, [initial]);
  async function upload(file: File) { setPending(true); setError(""); const data = new FormData(); data.set("file", file); data.set("entityType", entityType); data.set("entityId", entityId); const response = await fetch("/api/files", { method: "POST", body: data }); const body = await response.json(); if (!response.ok) setError(body.error ?? t("uploadFailed")); else setFiles((value) => [...value, body]); setPending(false); }
  async function remove(id: string) { if (!confirm(t("deleteAttachmentConfirm"))) return; setError(""); const response = await fetch(`/api/files/${id}`, { method: "DELETE" }); const body = await response.json(); if (response.ok) setFiles((value) => value.filter((file) => file.id !== id)); else setError(body.error === "attachmentInUse" ? t("attachmentInUse") : body.error ?? t("deleteAttachmentFailed")); }
  return <section className="space-y-2"><div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-medium"><Paperclip className="size-4 text-indigo-500" />{t("attachments")}</h3><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}{t("addFile")}</Button><input ref={input} data-testid="wiki-attachment-input" hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /></div>{error && <p className="text-xs text-destructive">{error}</p>}
    {files.length === 0 ? <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t("noAttachments")}</p> : <div className="divide-y rounded-md border">{files.map((file) => <div key={file.id} className="flex items-center gap-2 p-2 text-sm"><File className="size-4 text-indigo-400" /><span className="min-w-0 flex-1 truncate">{file.fileName}</span><span className="text-xs text-muted-foreground">{(file.sizeBytes / 1024 / 1024).toFixed(1)} MB</span><Button variant="ghost" size="icon-xs" nativeButton={false} render={<a href={`/api/files/${file.id}`} target="_blank" rel="noreferrer" />}><Download className="size-3.5" /></Button><Button variant="ghost" size="icon-xs" onClick={() => remove(file.id)}><Trash2 className="size-3.5" /></Button></div>)}</div>}
  </section>;
});
