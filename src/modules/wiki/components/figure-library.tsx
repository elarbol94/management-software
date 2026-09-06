"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { FigureAssetDto, FigureManifest } from "../lib/figure-types";
import { folderPermission, loadFigureFolder, readFigureFolderFile } from "../lib/figure-folder";
import { registerFigureExportRefresh } from "../lib/editor-export";

const EMPTY: FigureManifest = { sources: [], assets: [], roots: [] };
type ApiResult = FigureManifest & { result?: { id: string; attachmentId?: string; fileName?: string; mimeType?: string; contentUrl?: string }; error?: string };
export function useFigureLibrary(pageId: string, staleExportMessage: string) {
  const [manifest, setManifest] = useState<FigureManifest>(EMPTY);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const latest = useRef(manifest);
  const exportScope = useRef<Set<string> | null>(null);
  const mounted = useRef(true);
  const busy = useRef<Promise<boolean> | null>(null);
  const hashes = useRef(new Map<string, string>());
  const endpoint = `/api/wiki/pages/${encodeURIComponent(pageId)}/figures`;
  const request = useCallback(async (body?: FormData | object, method = "POST", signal?: AbortSignal): Promise<ApiResult> => {
    const response = await fetch(endpoint, body ? { method, body: body instanceof FormData ? body : JSON.stringify(body), headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" }, signal } : { cache: "no-store", signal });
    const data = await response.json() as ApiResult;
    if (!response.ok) throw new Error(data.error || "sourceUnavailable");
    if (mounted.current) { latest.current = data; setManifest(data); }
    return data;
  }, [endpoint]);
  const refresh = useCallback(function refreshSources(forExport = false): Promise<boolean> {
    if (busy.current) return busy.current.then((result) => forExport ? refreshSources(true) : result);
    const operation = async () => {
      const errors: Record<string, string> = {};
      let current: ApiResult;
      try { current = await request(forExport ? { action: "refresh" } : undefined); }
      catch { return false; }
      for (const asset of current.assets) {
        if (!asset.sourceId || asset.paused || (forExport && exportScope.current && !exportScope.current.has(asset.id))) continue;
        const source = current.sources.find((item) => item.id === asset.sourceId);
        if (source?.kind === "server") { if (asset.status !== "ready") errors[asset.id] = asset.status; continue; }
        if (!source?.owned) { if (forExport) errors[asset.id] = "sourceUnavailable"; continue; }
        try {
          const folder = await loadFigureFolder(source.id);
          if (!folder || await folderPermission(folder.handle, false) !== "granted") throw new Error("reconnect");
          const file = await readFigureFolderFile(folder, asset.relativePath);
          let sidecar: string | undefined;
          try {
            const sidecarFile = await readFigureFolderFile(folder, asset.relativePath.replace(/\.[^/.]+$/, ".json"));
            if (sidecarFile.size > 100_000) throw new Error("invalidSidecar");
            sidecar = await sidecarFile.text();
          } catch (error) { if ((error as Error).message !== "sourceUnavailable" && (error as DOMException).name !== "NotFoundError") throw error; }
          if (!file.size || file.size > 50 * 1024 * 1024) throw new Error("invalidFile");
          const bytes = await file.arrayBuffer();
          const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("") + (sidecar ?? "");
          const key = `${asset.id}:${asset.version}`;
          if (!forExport && hashes.current.get(key) === digest) continue;
          const form = new FormData();
          form.set("file", new File([bytes], file.name, { type: file.type }));
          form.set("sourceId", source.id); form.set("path", asset.relativePath);
          form.set("assetId", asset.id); form.set("expectedVersion", String(asset.version));
          if (sidecar !== undefined) form.set("sidecar", sidecar);
          const response = await request(form);
          const version = response.assets.find((item) => item.id === asset.id)?.version;
          hashes.current.set(`${asset.id}:${version}`, digest);
        } catch (error) { errors[asset.id] = error instanceof Error ? error.message : "sourceUnavailable"; }
      }
      if (mounted.current) setFailures(errors);
      return Object.keys(errors).length === 0;
    };
    busy.current = operation().finally(() => { busy.current = null; });
    return busy.current;
  }, [request]);
  useEffect(() => {
    mounted.current = true;
    const sync = () => { if (document.visibilityState === "visible") void refresh(); };
    sync();
    const timer = window.setInterval(sync, 2000);
    window.addEventListener("online", sync); document.addEventListener("visibilitychange", sync);
    const unregister = registerFigureExportRefresh(pageId, async () => {
      const current = await refresh(true);
      if (!current && !window.confirm(staleExportMessage)) return false;
      return { allowSaved: !current, revisions: Object.fromEntries(latest.current.assets.map((asset) => [asset.id, asset.version])) };
    });
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener("online", sync); document.removeEventListener("visibilitychange", sync); unregister(); };
  }, [pageId, refresh, staleExportMessage]);
  return { manifest, failures, request, refresh, pageId, exportScope };
}
export type FigureLibrary = ReturnType<typeof useFigureLibrary> & { replace?: (nodeId: string) => void; editSource?: (nodeId: string) => void; editArtwork?: (nodeId: string) => void };
export const FigureLibraryContext = createContext<FigureLibrary | null>(null);
export const useFigures = () => useContext(FigureLibraryContext);
export function figureAssetAttributes(asset: FigureAssetDto) {
  return { assetId: asset.id, attachmentId: asset.attachmentId, src: asset.src, caption: asset.caption, numbered: true, includeInFigureIndex: true };
}
