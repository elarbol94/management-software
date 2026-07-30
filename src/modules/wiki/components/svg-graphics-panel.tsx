"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { History, ImageIcon, Layers3, Loader2, RotateCcw, Save, Type, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SvgAssetDto, SvgTextLayer } from "../svg-assets";

type Props = {
  pageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variables: Record<string, string>;
  onAssetReady: (attachmentId: string, contentUrl: string) => void;
};

export function SvgGraphicsPanel({ pageId, open, onOpenChange, variables, onAssetReady }: Props) {
  const t = useTranslations("wiki.graphics");
  const [assets, setAssets] = useState<SvgAssetDto[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<SvgTextLayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [baseSvg, setBaseSvg] = useState("");
  const [scaleDraft, setScaleDraft] = useState<number | null>(null);
  const selected = assets.find((asset) => asset.id === selectedId) ?? assets[0];
  const variableKeys = useMemo(() => ["title", "author", ...Object.keys(variables).filter((key) => !["title", "author"].includes(key))], [variables]);
  const livePreviewUrl = useMemo(() => {
    if (!baseSvg || !selected || typeof DOMParser === "undefined") return selected?.contentUrl ?? "";
    const document = new DOMParser().parseFromString(baseSvg, "image/svg+xml");
    const elements = [...Array.from(document.getElementsByTagName("text")), ...Array.from(document.getElementsByTagName("tspan"))];
    for (const layer of draft) {
      const element = elements.find((candidate) => candidate.getAttribute("data-wiki-text-id") === layer.id);
      if (!element || element.getElementsByTagName("tspan").length > 0) continue;
      while (element.firstChild) element.removeChild(element.firstChild);
      element.appendChild(document.createTextNode(layer.binding ? variables[layer.binding] ?? "" : layer.text));
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(document))}`;
  }, [baseSvg, draft, selected, variables]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      await fetch(`/api/wiki/pages/${encodeURIComponent(pageId)}/svg-assets`)
      .then(async (response) => {
        if (!response.ok) throw new Error(t("loadFailed"));
        return response.json() as Promise<{ assets: SvgAssetDto[] }>;
      })
      .then(({ assets: next }) => {
        if (cancelled) return;
        setAssets(next);
        const nextSelected = next[0];
        setSelectedId(nextSelected?.id ?? "");
        setDraft(nextSelected?.layers.map((layer) => ({ ...layer })) ?? []);
        setScaleDraft(nextSelected?.sizeScale ?? null);
        for (const asset of next) onAssetReady(asset.attachmentId, asset.contentUrl);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : t("loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    };
    void load();
    return () => { cancelled = true; };
  }, [onAssetReady, open, pageId, t]);

  useEffect(() => {
    if (!open || !selected) return;
    const controller = new AbortController();
    void fetch(selected.contentUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(t("loadFailed"));
        return response.text();
      })
      .then(setBaseSvg)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : t("loadFailed"));
      });
    return () => controller.abort();
  }, [open, selected, t]);

  async function refreshAssets(preferredId: string) {
    const response = await fetch(`/api/wiki/pages/${encodeURIComponent(pageId)}/svg-assets`);
    if (!response.ok) throw new Error(t("loadFailed"));
    const result = await response.json() as { assets: SvgAssetDto[] };
    setAssets(result.assets);
    const refreshed = result.assets.find((asset) => asset.id === preferredId) ?? result.assets[0];
    setSelectedId(refreshed?.id ?? "");
    setDraft(refreshed?.layers.map((layer) => ({ ...layer })) ?? []);
    setScaleDraft(refreshed?.sizeScale ?? null);
    if (refreshed) onAssetReady(refreshed.attachmentId, refreshed.contentUrl);
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/wiki/pages/${encodeURIComponent(pageId)}/svg-assets`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", assetId: selected.id, expectedVersion: selected.version, layers: draft, sizeScale: scaleDraft }),
      });
      const result = await response.json() as { saved?: boolean; conflict?: boolean; version?: number; layers?: SvgTextLayer[]; contentUrl?: string; error?: string };
      if (!response.ok || !result.saved || !result.layers || !result.contentUrl || !result.version) {
        throw new Error(result.conflict ? t("conflict") : result.error ?? t("saveFailed"));
      }
      await refreshAssets(selected.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function restore(revisionId: string) {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/wiki/pages/${encodeURIComponent(pageId)}/svg-assets`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", assetId: selected.id, revisionId, expectedVersion: selected.version }),
      });
      const result = await response.json() as { saved?: boolean; conflict?: boolean; error?: string };
      if (!response.ok || !result.saved) throw new Error(result.conflict ? t("conflict") : result.error ?? t("restoreFailed"));
      await refreshAssets(selected.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("restoreFailed"));
    } finally {
      setSaving(false);
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      showCloseButton={false}
      data-testid="svg-graphics-dialog"
      className="grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden border-slate-300/80 p-0 shadow-2xl dark:border-slate-700"
      style={{ width: "calc(100vw - 1rem)", maxWidth: "none", height: "calc(100dvh - 1rem)" }}
    >
      <DialogHeader className="border-b bg-background px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-600 text-white"><Layers3 className="size-4" /></div>
          <div className="min-w-0 flex-1">
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("close")} onClick={() => onOpenChange(false)}><X /></Button>
        </div>
      </DialogHeader>
      {loading ? <div className="grid flex-1 place-items-center"><Loader2 className="size-5 animate-spin text-indigo-600" /></div>
        : error && !assets.length ? <div role="alert" className="m-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
        : !assets.length ? <div className="grid flex-1 place-items-center p-8 text-center"><div><ImageIcon className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="font-medium">{t("empty")}</p><p className="mt-1 text-sm text-muted-foreground">{t("emptyHint")}</p></div></div>
        : <div className="grid min-h-0 flex-1 md:grid-cols-[17rem_minmax(0,1fr)]">
          <nav className="overflow-y-auto border-r bg-slate-50/70 p-3 dark:bg-slate-950/25" aria-label={t("assets")}>
            {assets.map((asset) => <button key={asset.id} type="button" onClick={() => { setSelectedId(asset.id); setDraft(asset.layers.map((layer) => ({ ...layer }))); setScaleDraft(asset.sizeScale ?? null); }} className={`mb-2 w-full rounded-lg border p-2 text-left transition-colors ${selected?.id === asset.id ? "border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/35" : "hover:bg-accent"}`}>
              {/* SVG previews are authenticated, versioned application assets and cannot use the Next image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.contentUrl} alt="" className="mb-2 aspect-[4/3] w-full rounded bg-white object-contain" />
              <span className="block truncate text-xs font-medium">{asset.fileName}</span>
              <span className="text-[10px] text-muted-foreground">{t("version", { version: asset.version })}</span>
            </button>)}
          </nav>
          {selected && <div className="grid min-h-0 grid-rows-[minmax(18rem,52vh)_minmax(0,1fr)_auto]">
            <div className="bg-slate-100 p-5 dark:bg-slate-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={livePreviewUrl} alt={selected.fileName} className="size-full rounded-lg border bg-white object-contain shadow-sm" />
            </div>
            <div className="overflow-y-auto p-5">
              <div className="mb-3 flex items-center gap-2"><Type className="size-4 text-indigo-600" /><h3 className="text-sm font-semibold">{t("textLayers")}</h3><span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{draft.length}</span></div>
              {!draft.length ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("noText")}</p>
                : <div className="space-y-3">{draft.map((layer, index) => <div key={layer.id} data-testid={`svg-text-layer-${layer.id}`} className="grid gap-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-[10px] text-muted-foreground">{layer.id}</span><Select value={layer.binding || "fixed"} onValueChange={(value) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, binding: value === "fixed" ? "" : value ?? "" } : item))}><SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">{t("fixedText")}</SelectItem>{variableKeys.map((key) => <SelectItem key={key} value={key}>{`{${key}}`}</SelectItem>)}</SelectContent></Select></div>
                  <Input value={layer.binding ? variables[layer.binding] ?? layer.text : layer.text} disabled={Boolean(layer.binding)} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} />
                </div>)}</div>}
              {!!selected.revisions.length && <section className="mt-6 border-t pt-4">
                <div className="mb-2 flex items-center gap-2"><History className="size-4 text-indigo-600" /><h3 className="text-sm font-semibold">{t("history")}</h3></div>
                <div className="space-y-1">{selected.revisions.map((revision) => <div key={revision.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/60">
                  <span className="flex-1">{t("version", { version: revision.version })} · {new Date(revision.createdAt).toLocaleString()}</span>
                  <Button type="button" size="xs" variant="ghost" disabled={saving} onClick={() => void restore(revision.id)}><RotateCcw className="size-3.5" />{t("restore")}</Button>
                </div>)}</div>
              </section>}
            </div>
            <div className="flex items-center gap-3 border-t px-5 py-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground" title={t("scaleHint")}>
                {t("scale")}
                <Input
                  className="h-8 w-24"
                  type="number"
                  min={0.25}
                  max={4}
                  step={0.05}
                  data-testid="svg-asset-scale"
                  placeholder={t("scaleInherit")}
                  value={scaleDraft ?? ""}
                  onChange={(event) => setScaleDraft(event.target.value === "" ? null : Number(event.target.value))}
                />
              </label>
              {error && <p role="alert" className="min-w-0 flex-1 truncate text-xs text-destructive">{error}</p>}
              <Button type="button" className="ml-auto" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{t("save")}</Button>
            </div>
          </div>}
        </div>}
    </DialogContent>
  </Dialog>;
}
