export type DocumentExportFormat = "pdf" | "docx" | "html" | "markdown";

export async function exportSavedDocument(pageId: string, format: DocumentExportFormat, inline: boolean, flushSave: () => Promise<boolean>, onError: () => void) {
  // Open preview synchronously with the click so popup blockers allow it.
  const preview = inline ? window.open("about:blank", "_blank") : null;
  if (preview) preview.opener = null;
  try {
    if (!await flushSave()) throw new Error("Unsaved document");
    const url = `/api/wiki/pages/${encodeURIComponent(pageId)}/export?format=${format}${inline ? "&disposition=inline" : ""}`;
    if (preview) preview.location.replace(url);
    else window.location.assign(url);
  } catch {
    preview?.close();
    onError();
  }
}
