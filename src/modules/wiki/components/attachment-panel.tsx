"use client";
import { forwardRef, useImperativeHandle, useRef, useState, type ForwardedRef } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Download, File, Loader2, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Attachment = { id: string; fileName: string; mimeType: string; sizeBytes: number };

/** Picks the unit that keeps a digit: an SVG diagram of 3 KB read "0.0 MB" before. */
function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export type AttachmentPanelHandle = { openFilePicker: () => void };
type AttachmentPanelProps = { entityType: "wikiPage" | "wikiSource"; entityId: string; initial: Attachment[] };

export const AttachmentPanel = forwardRef<AttachmentPanelHandle, AttachmentPanelProps>(function AttachmentPanel(props, ref) {
  const attachmentKey = `${props.entityType}:${props.entityId}:${props.initial.map((file) => file.id).join(",")}`;
  return <AttachmentPanelContent key={attachmentKey} {...props} panelRef={ref} />;
});

function AttachmentPanelContent({ entityType, entityId, initial, panelRef }: AttachmentPanelProps & { panelRef: ForwardedRef<AttachmentPanelHandle> }) {
  const t = useTranslations("wiki"); const common = useTranslations("common"); const input = useRef<HTMLInputElement>(null); const [files, setFiles] = useState(initial); const [pending, setPending] = useState(false); const [removingId, setRemovingId] = useState(""); const [error, setError] = useState(""); const [collapsed, setCollapsed] = useState(true);
  useImperativeHandle(panelRef, () => ({ openFilePicker: () => input.current?.click() }), []);
  async function upload(file: File) {
    setPending(true); setError("");
    const data = new FormData();
    data.set("file", file); data.set("entityType", entityType); data.set("entityId", entityId);
    try {
      const response = await fetch("/api/files", { method: "POST", body: data });
      const body = await response.json().catch(() => ({})) as Partial<Attachment> & { error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? t("uploadFailed"));
      setFiles((value) => [...value, body as Attachment]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("uploadFailed"));
    } finally {
      setPending(false);
    }
  }
  async function remove(id: string) {
    if (!confirm(t("deleteAttachmentConfirm"))) return;
    setRemovingId(id); setError("");
    try {
      const response = await fetch(`/api/files/${id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error === "attachmentInUse" ? t("attachmentInUse") : body.error ?? t("deleteAttachmentFailed"));
      setFiles((value) => value.filter((file) => file.id !== id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("deleteAttachmentFailed"));
    } finally {
      setRemovingId("");
    }
  }
  return <section className="space-y-2"><button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)} className="flex w-full items-center gap-2 text-left text-sm font-medium"><ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} /><Paperclip className="size-4 text-indigo-500" />{t("attachments")}</button>{!collapsed && <><div className="flex justify-end"><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}{t("addFile")}</Button><input ref={input} data-testid="wiki-attachment-input" hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} /></div>{error && <p className="text-xs text-destructive">{error}</p>}
    {files.length === 0 ? <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t("noAttachments")}</p> : <div className="divide-y rounded-md border">{files.map((file) => <div key={file.id} className="flex items-center gap-2 p-2 text-sm"><File className="size-4 text-indigo-400" /><span className="min-w-0 flex-1 truncate">{file.fileName}</span><span className="text-xs text-muted-foreground">{formatFileSize(file.sizeBytes)}</span><Button aria-label={t("downloadAttachment", { name: file.fileName })} title={t("downloadAttachment", { name: file.fileName })} variant="ghost" size="icon-xs" nativeButton={false} render={<a href={`/api/files/${file.id}`} target="_blank" rel="noreferrer" />}><Download className="size-3.5" /></Button><Button aria-label={`${common("delete")}: ${file.fileName}`} title={`${common("delete")}: ${file.fileName}`} variant="ghost" size="icon-xs" disabled={removingId === file.id} onClick={() => remove(file.id)}>{removingId === file.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}</Button></div>)}</div>}</>}
  </section>;
}
