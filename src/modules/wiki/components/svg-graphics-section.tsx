"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, FolderUp, Images, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SvgAssetDto, SvgFolderSyncResult } from "../svg-assets";
import { clearFolderHandle, collectSvgFiles, folderPermission, loadFolderHandle, pickFolder, saveFolderHandle, supportsFolderLink } from "../lib/svg-folder-source";

const SYNC_BATCH_SIZE = 20;

type Props = {
  pageId: string;
  onInsert: (asset: SvgAssetDto) => void;
};

/**
 * Sidebar home for a page's diagrams: browse them, drop one into the document,
 * and keep them in step with the linked source folder. Text editing stays in
 * the full-screen panel, which needs the room.
 */
export function SvgGraphicsSection({ pageId, onInsert }: Props) {
  const t = useTranslations("wiki.graphics");
  const [assets, setAssets] = useState<SvgAssetDto[]>([]);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [folderName, setFolderName] = useState("");
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const autoSynced = useRef(false);
  const canLinkFolder = supportsFolderLink();

  const refreshAssets = useCallback(async () => {
    const response = await fetch(`/api/wiki/pages/${encodeURIComponent(pageId)}/svg-assets`);
    if (!response.ok) throw new Error(t("loadFailed"));
    const result = await response.json() as { assets: SvgAssetDto[] };
    setAssets(result.assets);
  }, [pageId, t]);

  const syncFiles = useCallback(async (files: Array<{ path: string; file: File }>, silent: boolean) => {
    if (!files.length) {
      if (!silent) setError(t("importNothing"));
      return;
    }
    setError("");
    setSummary("");
    setImportProgress({ done: 0, total: files.length });
    const totals = { added: 0, updated: 0, unchanged: 0, failed: [] as string[] };
    // Batched so one huge multipart request cannot trip a proxy body limit.
    for (let start = 0; start < files.length; start += SYNC_BATCH_SIZE) {
      const batch = files.slice(start, start + SYNC_BATCH_SIZE);
      const data = new FormData();
      for (const item of batch) {
        data.append("files", item.file);
        data.append("paths", item.path);
      }
      const response = await fetch(`/api/wiki/pages/${encodeURIComponent(pageId)}/svg-assets`, { method: "POST", body: data }).catch(() => null);
      const body = response?.ok ? await response.json().catch(() => null) as SvgFolderSyncResult | null : null;
      if (!body) {
        totals.failed.push(...batch.map((item) => item.path));
      } else {
        totals.added += body.added;
        totals.updated += body.updated;
        totals.unchanged += body.unchanged;
        totals.failed.push(...body.failed.map((entry) => entry.path));
      }
      setImportProgress({ done: Math.min(start + SYNC_BATCH_SIZE, files.length), total: files.length });
    }
    await refreshAssets().catch(() => setError(t("loadFailed")));
    setImportProgress(null);
    if (!silent || totals.added || totals.updated) {
      setSummary(t("importSummary", { added: totals.added, updated: totals.updated, unchanged: totals.unchanged }));
    }
    if (totals.failed.length) setError(t("importFailed", { count: totals.failed.length, names: totals.failed.slice(0, 3).join(", ") }));
  }, [pageId, refreshAssets, t]);

  // Loads the list, then re-reads the linked folder once per page visit.
  // Permission is only queried, never requested, so a page load can never
  // raise a browser prompt.
  useEffect(() => {
    if (autoSynced.current) return;
    autoSynced.current = true;
    let cancelled = false;
    void (async () => {
      await refreshAssets().catch(() => setError(t("loadFailed")));
      const handle = await loadFolderHandle(pageId);
      if (!handle || cancelled) return;
      setFolderName(handle.name);
      if (await folderPermission(handle, false) !== "granted" || cancelled) return;
      const files = await collectSvgFiles(handle);
      await syncFiles(files, true);
    })().catch(() => { if (!cancelled) setError(t("importFailedGeneric")); });
    return () => { cancelled = true; };
  }, [pageId, refreshAssets, syncFiles, t]);

  async function linkFolder() {
    try {
      const handle = await pickFolder();
      await saveFolderHandle(pageId, handle);
      setFolderName(handle.name);
      await syncFiles(await collectSvgFiles(handle), false);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : t("importFailedGeneric"));
    }
  }

  async function syncLinkedFolder() {
    try {
      const handle = await loadFolderHandle(pageId);
      if (!handle) return await linkFolder();
      if (await folderPermission(handle, true) !== "granted") {
        await clearFolderHandle(pageId);
        setFolderName("");
        setError(t("folderPermissionDenied"));
        return;
      }
      const files = await collectSvgFiles(handle);
      await syncFiles(files, false);
    } catch {
      setError(t("importFailedGeneric"));
    }
  }

  return <section data-testid="wiki-graphics-section" className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)} className="flex min-w-0 items-center gap-2 text-left text-sm font-medium"><ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} /><Images className="size-4 text-indigo-500" />{t("title")}</button>
      {!collapsed && <Button type="button" variant="outline" size="sm" data-testid="svg-folder-sync" disabled={Boolean(importProgress)} onClick={() => { if (canLinkFolder) void syncLinkedFolder(); else folderInput.current?.click(); }}>
        {importProgress ? <Loader2 className="size-4 animate-spin" /> : <FolderUp className="size-4" />}
        {importProgress ? t("importing", importProgress) : !canLinkFolder ? t("import") : folderName ? t("sync") : t("link")}
      </Button>}
      {/* Fallback for browsers without the File System Access API: a one-shot pick, no lasting link. */}
      {/* webkitdirectory has no React typing; set it on the node so one pick reads a whole folder. */}
      <input ref={(node) => { folderInput.current = node; node?.setAttribute("webkitdirectory", ""); }} data-testid="svg-folder-input" hidden type="file" multiple accept=".svg,.svgz,image/svg+xml" onChange={(event) => { void syncFiles(Array.from(event.target.files ?? []).filter((file) => /\.svgz?$/i.test(file.name)).map((file) => ({ path: file.webkitRelativePath || file.name, file })), false); event.target.value = ""; }} />
    </div>
    {!collapsed && <>{folderName && <p className="truncate text-[11px] text-muted-foreground">{t("linkedFolder", { name: folderName })}</p>}
    {summary && <p className="text-[11px] text-emerald-700 dark:text-emerald-400">{summary}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {!assets.length
      ? <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t("empty")}</p>
      : <div className="space-y-1">{assets.map((asset) => <div key={asset.id} className="group flex items-center gap-2 rounded-md border p-2">
        {/* SVG previews are authenticated, versioned application assets and cannot use the Next image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset.contentUrl} alt="" className="size-9 shrink-0 rounded bg-white object-contain" />
        <span className="min-w-0 flex-1 truncate text-xs" title={asset.sourcePath ?? asset.fileName}>{asset.fileName}</span>
        <Button type="button" size="xs" variant="ghost" data-testid={`svg-insert-${asset.id}`} title={t("insert")} aria-label={`${t("insert")}: ${asset.fileName}`} onClick={() => onInsert(asset)}><Plus className="size-3.5" /></Button>
      </div>)}</div>}
    </>}
  </section>;
}
