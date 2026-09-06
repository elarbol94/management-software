"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { figureMime, relativeFigurePath } from "../lib/figure";
import { listFigureFolderPaths, folderPermission, loadFigureFolder, pickFolder, readFigureFolderFile, saveFigureFolder, supportsFolderLink } from "../lib/figure-folder";
import type { FigureAssetDto } from "../lib/figure-types";
import { useFigures } from "./figure-library";

type Existing = { id: string; fileName: string; mimeType: string; src?: string; caption?: string };
export function FigurePicker({ open, onOpenChange, onInsert, onExisting, onUpload, onDiagram, selectedAssetId, sourceMode, onEditSvg }: {
  open: boolean; onOpenChange: (open: boolean) => void; onInsert: (asset: FigureAssetDto) => void;
  onExisting: (file: Existing) => void; onUpload: (files: File[]) => void; onDiagram: () => void; selectedAssetId?: string; sourceMode?: boolean; onEditSvg: (preferredId?: string) => void;
}) {
  const t = useTranslations("wiki.figures");
  const library = useFigures()!;
  const { manifest, request } = library;
  const [existing, setExisting] = useState<Existing[]>([]);
  const [tab, setTab] = useState("library");
  const [search, setSearch] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [path, setPath] = useState("");
  const [folderFiles, setFolderFiles] = useState<string[]>([]);
  const [prefix, setPrefix] = useState("");
  const [root, setRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement | null>(null);
  const selectedAsset = manifest.assets.find((asset) => asset.id === selectedAssetId);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void request().then(async (data) => {
      if (cancelled) return;
      const asset = data.assets.find((item) => item.id === selectedAssetId);
      setTab(sourceMode ? "path" : "library"); setSourceId(asset?.sourceId || ""); setPath(asset?.relativePath || ""); setError(""); setFolderFiles([]);
      if (asset?.sourceId) { const folder = await loadFigureFolder(asset.sourceId); if (!cancelled) setPrefix(folder?.prefix || ""); }
    }).catch(() => { if (!cancelled) setError("sourceUnavailable"); });
    void fetch(`/api/files?entityType=wikiPage&entityId=${encodeURIComponent(library.pageId)}`).then((response) => response.json()).then((files: Existing[]) => { if (!cancelled && Array.isArray(files)) setExisting(files.filter((file) => Boolean(figureMime(file.fileName)))); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [open, request, selectedAssetId, library.pageId, sourceMode]);
  const source = manifest.sources.find((item) => item.id === sourceId);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : "sourceUnavailable"); }
    finally { setBusy(false); }
  }
  async function connectFolder(reconnect = false) {
    // The chooser must run directly in the click, before any network request.
    const handle = await pickFolder();
    const id = reconnect && source?.kind === "laptop" ? source.id : (await request({ action: "source", source: { kind: "laptop", name: handle.name } })).result!.id;
    await saveFigureFolder(id, { handle, prefix }); setSourceId(id);
  }
  async function link() {
    let id = sourceId;
    if (!source) {
      const key = root || manifest.roots[0];
      if (!key) throw new Error("sourceUnavailable");
      id = (await request({ action: "source", source: { kind: "server", name: key, rootKey: key } })).result!.id;
      setSourceId(id);
    }
    const normalizedPath = source?.kind === "laptop" ? relativeFigurePath(path, prefix) : path;
    if (source?.kind === "laptop") {
      const folder = await loadFigureFolder(id);
      if (!folder) throw new Error("reconnect");
      if (await folderPermission(folder.handle, true) !== "granted") throw new Error("reconnect");
      folder.prefix = prefix; await saveFigureFolder(id, folder);
    }
    if (selectedAssetId && sourceMode) {
      await request({ action: "relink", assetId: selectedAssetId, expectedVersion: selectedAsset!.version, sourceId: id, path: normalizedPath }, "PATCH");
      await library.refresh(true); onOpenChange(false); return;
    }
    let response;
    if (source?.kind === "laptop") {
      const folder = await loadFigureFolder(id);
      if (!folder) throw new Error("reconnect");
      folder.prefix = prefix; await saveFigureFolder(id, folder);
      if (await folderPermission(folder.handle, true) !== "granted") throw new Error("reconnect");
      const file = await readFigureFolderFile(folder, normalizedPath);
      const form = new FormData(); form.set("file", file); form.set("sourceId", id); form.set("path", normalizedPath);
      const already = manifest.assets.find((asset) => asset.sourceId === id && asset.relativePath === normalizedPath);
      if (already) { onInsert(already); onOpenChange(false); return; }
      try { const sidecar = await readFigureFolderFile(folder, normalizedPath.replace(/\.[^/.]+$/, ".json")); if (sidecar.size > 100_000) throw new Error("invalidSidecar"); form.set("sidecar", await sidecar.text()); }
      catch (reason) { if ((reason as Error).message !== "sourceUnavailable" && (reason as DOMException).name !== "NotFoundError") throw reason; }
      response = await request(form);
    } else response = await request({ action: "link", sourceId: id, path: normalizedPath });
    const asset = response.assets.find((item) => item.id === response.result?.id);
    if (asset) { onInsert(asset); onOpenChange(false); }
  }
  async function assetAction(action: string, revisionId?: string) {
    if (!selectedAsset) return;
    const response = await request({ action, assetId: selectedAsset.id, expectedVersion: selectedAsset.version, revisionId }, "PATCH");
    if (action === "detach") { const asset = response.assets.find((item) => item.id === response.result?.id); if (asset) onInsert(asset); onOpenChange(false); }
  }
  const visible = manifest.assets.filter((asset) => asset.fileName.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const older = existing.filter((file) => !manifest.assets.some((asset) => asset.attachmentId === file.id) && file.fileName.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[85vh] max-w-2xl overflow-auto"><DialogHeader><DialogTitle>{t("insert")}</DialogTitle></DialogHeader>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("insert")}>{["library", "path"].map((value) => <Button type="button" key={value} role="tab" aria-selected={tab === value} variant={tab === value ? "secondary" : "ghost"} onClick={() => setTab(value)}>{t(value as "library")}</Button>)}</div>
    {tab === "library" ? <>
      <div className="flex flex-wrap gap-2"><Button type="button" onClick={() => input.current?.click()}>{t("upload")}</Button><Button type="button" variant="outline" onClick={() => { onDiagram(); onOpenChange(false); }}>{t("diagram")}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => void perform(async () => {
        if (selectedAsset?.mimeType === "image/svg+xml") {
          const response = await request({ action: "editableCopy", assetId: selectedAsset.id, expectedVersion: selectedAsset.version });
          const copy = response.result!;
          onExisting({ id: copy.attachmentId!, fileName: copy.fileName!, mimeType: "image/svg+xml", src: copy.contentUrl });
          onEditSvg(copy.id);
        } else onEditSvg();
      })}>{t("editSvg")}</Button></div>
      <input ref={input} hidden multiple type="file" accept=".png,.jpg,.jpeg,.webp,.svg,.svgz" data-testid="figure-picker-upload" onChange={(event) => { onUpload(Array.from(event.target.files || [])); onOpenChange(false); event.target.value = ""; }} />
      <Input aria-label={t("search")} placeholder={t("search")} value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className="grid max-h-72 grid-cols-2 gap-3 overflow-auto sm:grid-cols-3">
        {visible.map((asset) => <button type="button" key={asset.id} onClick={() => { onInsert(asset); onOpenChange(false); }} className="rounded border p-2 text-left hover:bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset.src} alt="" className="h-24 w-full bg-white object-contain" /><span className="mt-2 block truncate text-xs">{asset.caption || asset.fileName}</span>{asset.sourceId && <span className="text-xs text-muted-foreground">{t("live")}</span>}
        </button>)}
        {older.map((file) => <button type="button" key={file.id} data-testid={`wiki-existing-image-${file.id}`} onClick={() => { onExisting(file); onOpenChange(false); }} className="rounded border p-2 text-left hover:bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${file.id}`} alt="" className="h-24 w-full bg-white object-contain" /><span className="mt-2 block truncate text-xs">{file.fileName}</span>
        </button>)}
      </div>{!visible.length && !older.length && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
    </> : <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("pathHint")}</p>
      <label className="grid gap-1 text-sm">{t("source")}<select value={sourceId} onChange={(event) => { setSourceId(event.target.value); setFolderFiles([]); void loadFigureFolder(event.target.value).then((folder) => setPrefix(folder?.prefix || "")); }} className="h-9 rounded border bg-background px-2"><option value="">{t("serverFolder")}</option>{manifest.sources.map((item) => <option key={item.id} value={item.id}>{item.name} ({t(item.kind)})</option>)}</select></label>
      {!source && <label className="grid gap-1 text-sm">{t("serverFolder")}<select value={root || manifest.roots[0] || ""} onChange={(event) => setRoot(event.target.value)} className="h-9 rounded border bg-background px-2">{manifest.roots.map((key) => <option key={key}>{key}</option>)}</select>{!manifest.roots.length && <span className="text-xs text-muted-foreground">{t("noServerRoots")}</span>}</label>}
      {source?.kind === "laptop" && <>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void perform(async () => {
          const folder = await loadFigureFolder(source.id);
          if (!folder || await folderPermission(folder.handle, true) !== "granted") throw new Error("reconnect");
          setFolderFiles(await listFigureFolderPaths(folder.handle));
        })}>{t("browseFolder")}</Button>
        {folderFiles.length > 0 && <select aria-label={t("chooseFile")} value={folderFiles.includes(path) ? path : ""} onChange={(event) => setPath(event.target.value)} className="h-9 w-full rounded border bg-background px-2"><option value="">{t("chooseFile")}</option>{folderFiles.map((file) => <option key={file}>{file}</option>)}</select>}
      </>}
      <label className="grid gap-1 text-sm">{t("filePath")}<Input value={path} onChange={(event) => setPath(event.target.value)} placeholder="plots/revenue.svg" /></label>
      {(!source || source.kind === "laptop") && <label className="grid gap-1 text-sm">{t("prefix")}<Input value={prefix} onChange={(event) => setPrefix(event.target.value)} placeholder="C:\Research\plots" /><span className="text-xs text-muted-foreground">{t("prefixHint")}</span></label>}
      <div className="flex flex-wrap gap-2">{supportsFolderLink() ? <Button type="button" variant="outline" disabled={busy} onClick={() => void perform(() => connectFolder(Boolean(selectedAssetId)))}>{t(source?.kind === "laptop" ? "reconnect" : "connectFolder")}</Button> : <p className="text-xs text-muted-foreground">{t("browserUnsupported")}</p>}
        <Button type="button" disabled={busy || !path.trim() || (!source && !manifest.roots.length)} onClick={() => void perform(link)}>{t(selectedAssetId && sourceMode ? "relink" : "insertLinked")}</Button></div>
      {selectedAsset && <div className="space-y-2 border-t pt-3 text-sm"><p>{selectedAsset.relativePath} · {t(selectedAsset.paused ? "paused" : library.failures[selectedAsset.id] || selectedAsset.status !== "ready" ? "sourceUnavailable" : "live")}</p><p className="text-xs text-muted-foreground">{t("updated")}: {new Date(selectedAsset.updatedAt).toLocaleString()}</p>
        <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void perform(async () => { await library.refresh(true); })}>{t("retry")}</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void perform(() => assetAction(selectedAsset.paused ? "resume" : "pause"))}>{t(selectedAsset.paused ? "resume" : "pause")}</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void perform(() => assetAction("detach"))}>{t("detach")}</Button></div>
        <label className="grid gap-1">{t("restore")}<select disabled={busy} value="" onChange={(event) => { if (event.target.value) void perform(() => assetAction("restore", event.target.value)); }} className="h-9 rounded border bg-background px-2"><option value="">{t("chooseRevision")}</option>{selectedAsset.revisions.map((revision) => <option key={revision.id} value={revision.id}>{revision.version} · {new Date(revision.createdAt).toLocaleString()}</option>)}</select></label>
      </div>}
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{t.has(error) ? t(error as "sourceUnavailable") : t("invalidFile")}</p>}
    {busy && <p role="status" className="text-sm text-muted-foreground">{t("working")}</p>}
  </DialogContent></Dialog>;
}
