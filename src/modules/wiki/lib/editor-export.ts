export type DocumentExportFormat = "pdf" | "docx" | "html" | "markdown";
export type FigureExportSnapshot = { revisions: Record<string, number>; allowSaved: boolean };
const figureRefreshers = new Map<string, () => Promise<FigureExportSnapshot | false>>();
export function registerFigureExportRefresh(pageId: string, refresh: () => Promise<FigureExportSnapshot | false>) {
  figureRefreshers.set(pageId, refresh);
  return () => { if (figureRefreshers.get(pageId) === refresh) figureRefreshers.delete(pageId); };
}
export async function exportSavedDocument(pageId: string, format: DocumentExportFormat, inline: boolean, flushSave: () => Promise<boolean>, onError: () => void) {
  const preview = inline ? window.open("about:blank", "_blank") : null;
  if (preview) preview.opener = null;
  try {
    if (!await flushSave()) throw new Error("Unsaved document");
    const refresh = figureRefreshers.get(pageId);
    const snapshot = refresh ? await refresh() : undefined;
    if (snapshot === false) { preview?.close(); return; }
    if (!await flushSave()) throw new Error("Unsaved document");
    const response = await fetch(`/api/wiki/pages/${encodeURIComponent(pageId)}/export?format=${format}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot || {}),
    });
    if (!response.ok) throw new Error("Export failed");
    const url = URL.createObjectURL(await response.blob());
    if (preview) preview.location.replace(url);
    else {
      const link = document.createElement("a"); link.href = url;
      link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] || `document.${format}`;
      document.body.append(link); link.click(); link.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 300_000);
  } catch { preview?.close(); onError(); }
}
