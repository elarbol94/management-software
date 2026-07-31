"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BookMarked, ChevronDown, History, ImageIcon, Layers3, Loader2, RotateCcw, Save, Search, Type, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SvgAssetDto, SvgTextLayer } from "../svg-assets";
import type { DocumentSettingsV1 } from "../lib/document-settings";
import { diagramTypographyTarget } from "../lib/svg-typography";
import type { WikiTypographySettingsV1 } from "../lib/wiki-typography";

type Props = {
  pageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variables: Record<string, string>;
  documentSettings: DocumentSettingsV1;
  typography: WikiTypographySettingsV1;
  onDocumentSettingsChange: (settings: DocumentSettingsV1) => void;
  onAssetReady: (attachmentId: string, contentUrl: string) => void;
};

type Box = { left: number; top: number; width: number; height: number; containerWidth: number; containerHeight: number };

const EDITOR_HEIGHT = 44;

/** Sits under the label it edits, and flips above it near the bottom edge. */
function editorPosition(box: Box) {
  const below = box.top + box.height + 6;
  const top = below + EDITOR_HEIGHT > box.containerHeight ? Math.max(4, box.top - EDITOR_HEIGHT - 6) : below;
  return {
    left: Math.max(4, Math.min(box.left - 8, box.containerWidth - 264)),
    top,
    minWidth: Math.max(box.width + 32, 240),
  };
}

const TEXT_NODE = 3;

/**
 * Rewrites only what the element owns, mirroring `setOwnSvgText` on the server so
 * the preview shows exactly what a save would write.
 */
function setOwnText(element: SVGElement, value: string) {
  const owned = Array.from(element.childNodes).filter((node) => node.nodeType === TEXT_NODE);
  let anchor = owned[0]?.nextSibling ?? null;
  while (anchor && anchor.nodeType === TEXT_NODE) anchor = anchor.nextSibling;
  for (const node of owned) element.removeChild(node);
  if (!value) return;
  const text = element.ownerDocument.createTextNode(value);
  if (anchor) element.insertBefore(text, anchor);
  else element.appendChild(text);
}

export function SvgGraphicsPanel({ pageId, open, onOpenChange, variables, documentSettings, typography, onDocumentSettingsChange, onAssetReady }: Props) {
  const t = useTranslations("wiki.graphics");
  const tDocument = useTranslations("wiki.document");
  const [assets, setAssets] = useState<SvgAssetDto[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<SvgTextLayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [baseSvg, setBaseSvg] = useState("");
  const [scaleDraft, setScaleDraft] = useState<number | null>(null);
  const [activeId, setActiveId] = useState("");
  const [activeBox, setActiveBox] = useState<Box | null>(null);
  const [hoverBox, setHoverBox] = useState<Box | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [query, setQuery] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const escapeValue = useRef("");
  const selected = assets.find((asset) => asset.id === selectedId) ?? assets[0];
  const variableKeys = useMemo(() => ["title", "author", ...Object.keys(variables).filter((key) => !["title", "author"].includes(key))], [variables]);
  const layerValue = useCallback((layer: SvgTextLayer) => layer.binding ? variables[layer.binding] ?? "" : layer.text, [variables]);
  const dirty = Boolean(selected) && (
    JSON.stringify(draft) !== JSON.stringify(selected?.layers ?? [])
    || scaleDraft !== (selected?.sizeScale ?? null)
  );

  // Inlined rather than dropped into an <img>, so every label is a real node that
  // can be clicked, measured and edited where it sits. The markup is the SVG the
  // server already sanitised (see isSafeInlineSvg).
  const previewSvg = useMemo(() => {
    if (!baseSvg || typeof DOMParser === "undefined") return "";
    const parsed = new DOMParser().parseFromString(baseSvg, "image/svg+xml");
    for (const layer of draft) {
      const element = parsed.querySelector(`[data-wiki-text-id="${CSS.escape(layer.id)}"]`);
      if (element instanceof SVGElement) setOwnText(element, layerValue(layer));
    }
    return new XMLSerializer().serializeToString(parsed);
  }, [baseSvg, draft, layerValue]);

  const boxFor = useCallback((id: string): Box | null => {
    const container = previewRef.current;
    const element = container?.querySelector(`[data-wiki-text-id="${CSS.escape(id)}"]`);
    if (!container || !element) return null;
    const rect = element.getBoundingClientRect();
    const base = container.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    // The container size travels with the box so the floating field can be kept
    // inside the preview without reading the ref while rendering.
    return {
      left: rect.left - base.left,
      top: rect.top - base.top,
      width: rect.width,
      height: rect.height,
      containerWidth: base.width,
      containerHeight: base.height,
    };
  }, []);

  const activate = useCallback((id: string) => {
    const layer = draft.find((item) => item.id === id);
    if (!layer) return;
    escapeValue.current = layer.text;
    setActiveId(id);
    setActiveBox(boxFor(id));
  }, [boxFor, draft]);

  const closeEditor = useCallback(() => {
    setActiveId("");
    setActiveBox(null);
  }, []);

  // The box is measured once per label so the field does not jump around while
  // typing changes the text's width; a resize still has to re-measure it.
  useEffect(() => {
    if (!activeId) return;
    const remeasure = () => setActiveBox(boxFor(activeId));
    window.addEventListener("resize", remeasure);
    return () => window.removeEventListener("resize", remeasure);
  }, [activeId, boxFor]);

  const load = useCallback(async (preferredId: string) => {
    const response = await fetch(`/api/wiki/pages/${encodeURIComponent(pageId)}/svg-assets`);
    if (!response.ok) throw new Error(t("loadFailed"));
    const result = await response.json() as { assets: SvgAssetDto[] };
    setAssets(result.assets);
    const next = result.assets.find((asset) => asset.id === preferredId) ?? result.assets[0];
    setSelectedId(next?.id ?? "");
    setDraft(next?.layers.map((layer) => ({ ...layer })) ?? []);
    setScaleDraft(next?.sizeScale ?? null);
    return result.assets;
  }, [pageId, t]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const start = async () => {
      setLoading(true);
      setError("");
      try {
        const next = await load("");
        if (cancelled) return;
        for (const asset of next) onAssetReady(asset.attachmentId, asset.contentUrl);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void start();
    return () => { cancelled = true; };
  }, [load, onAssetReady, open, t]);

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

  function editLayer(id: string, text: string) {
    setDraft((current) => current.map((layer) => layer.id === id ? { ...layer, text } : layer));
  }

  function bindLayer(id: string, binding: string) {
    setDraft((current) => current.map((layer) => layer.id === id ? { ...layer, binding } : layer));
  }

  function selectAsset(asset: SvgAssetDto) {
    if (asset.id === selected?.id) return;
    if (dirty && !confirm(t("discardConfirm"))) return;
    closeEditor();
    setQuery("");
    setSelectedId(asset.id);
    setDraft(asset.layers.map((layer) => ({ ...layer })));
    setScaleDraft(asset.sizeScale ?? null);
  }

  /** Tab walks the labels in list order so the whole graphic is reachable from the keyboard. */
  function stepLayer(offset: number) {
    const index = draft.findIndex((layer) => layer.id === activeId);
    const next = draft[index + offset];
    if (next) activate(next.id);
  }

  const save = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/wiki/pages/${encodeURIComponent(pageId)}/svg-assets`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", assetId: selected.id, expectedVersion: selected.version, layers: draft, sizeScale: scaleDraft }),
      });
      const result = await response.json() as { saved?: boolean; conflict?: boolean; error?: string };
      if (!response.ok || !result.saved) throw new Error(result.conflict ? t("conflict") : result.error ?? t("saveFailed"));
      closeEditor();
      const next = await load(selected.id);
      const refreshed = next.find((asset) => asset.id === selected.id);
      if (refreshed) onAssetReady(refreshed.attachmentId, refreshed.contentUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [closeEditor, draft, load, onAssetReady, pageId, scaleDraft, selected, t]);

  useEffect(() => {
    if (!open) return;
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [open, save]);

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
      closeEditor();
      await load(selected.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("restoreFailed"));
    } finally {
      setSaving(false);
    }
  }

  const activeLayer = draft.find((layer) => layer.id === activeId);
  const savedLayer = selected?.layers.find((layer) => layer.id === activeId);
  const matchFont = documentSettings.diagrams.matchFont;
  const target = diagramTypographyTarget(documentSettings, typography);
  const visibleLayers = query.trim()
    ? draft.filter((layer) => layerValue(layer).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    : draft;

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
            <DialogDescription>{t("editInGraphic")}</DialogDescription>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("close")} onClick={() => onOpenChange(false)}><X /></Button>
        </div>
      </DialogHeader>
      {loading ? <div className="grid flex-1 place-items-center"><Loader2 className="size-5 animate-spin text-indigo-600" /></div>
        : error && !assets.length ? <div role="alert" className="m-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
        : !assets.length ? <div className="grid flex-1 place-items-center p-8 text-center"><div><ImageIcon className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="font-medium">{t("empty")}</p><p className="mt-1 text-sm text-muted-foreground">{t("emptyHint")}</p></div></div>
        : <div className="grid min-h-0 flex-1 md:grid-cols-[15rem_minmax(0,1fr)]">
          <nav className="overflow-y-auto border-r bg-slate-50/70 p-3 dark:bg-slate-950/25" aria-label={t("assets")}>
            {assets.map((asset) => <button key={asset.id} type="button" onClick={() => selectAsset(asset)} className={`mb-2 w-full rounded-lg border p-2 text-left transition-colors ${selected?.id === asset.id ? "border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/35" : "hover:bg-accent"}`}>
              {/* SVG previews are authenticated, versioned application assets and cannot use the Next image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.contentUrl} alt="" className="mb-2 aspect-[4/3] w-full rounded bg-white object-contain" />
              <span className="block truncate text-xs font-medium">{asset.fileName}</span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">{t("version", { version: asset.version })}
                {asset.sourceTitle && <BookMarked className="size-3 shrink-0 text-emerald-600" aria-label={t("linkedSource", { title: asset.sourceTitle })} />}
              </span>
            </button>)}
          </nav>
          {selected && <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
              <span className="min-w-0 truncate text-sm font-medium">{selected.fileName}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{t("version", { version: selected.version })}</span>
              {dirty && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">{t("unsaved")}</span>}
              {/* The one typography question worth answering here; the rest stays in the layout panel. */}
              <label className="ml-auto flex items-center gap-2 rounded-lg border px-2 py-1 text-xs" title={t("matchFontHint")}>
                <input
                  type="checkbox"
                  data-testid="svg-match-font"
                  className="size-3.5 accent-indigo-600"
                  checked={matchFont}
                  onChange={(event) => onDocumentSettingsChange({ ...documentSettings, diagrams: { ...documentSettings.diagrams, matchFont: event.target.checked } })}
                />
                <span className="text-muted-foreground">{matchFont
                  ? t("matchesDocument", { font: tDocument(`font.${target.bodyFont}`), size: target.bodySizePt })
                  : t("ownFont")}</span>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title={t("scaleHint")}>
                {t("scale")}
                <Input className="h-7 w-20" type="number" min={0.25} max={4} step={0.05} data-testid="svg-asset-scale" placeholder={t("scaleInherit")} value={scaleDraft ?? ""} onChange={(event) => setScaleDraft(event.target.value === "" ? null : Number(event.target.value))} />
              </label>
              <Button type="button" size="sm" disabled={saving || !dirty} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{t("save")}</Button>
            </div>

            <div className="min-h-0 bg-slate-100 p-5 dark:bg-slate-900">
              <div ref={previewRef} className="relative size-full rounded-lg border bg-white shadow-sm">
                <div
                  data-testid="svg-preview"
                  className="size-full [&>svg]:size-full [&_[data-wiki-text-id]]:cursor-text"
                  onClick={(event) => {
                    const label = (event.target as globalThis.Element).closest("[data-wiki-text-id]");
                    const id = label?.getAttribute("data-wiki-text-id") ?? "";
                    if (draft.some((layer) => layer.id === id)) activate(id);
                    else closeEditor();
                  }}
                  onMouseOver={(event) => {
                    const label = (event.target as globalThis.Element).closest("[data-wiki-text-id]");
                    const id = label?.getAttribute("data-wiki-text-id") ?? "";
                    setHoverBox(id && id !== activeId && draft.some((layer) => layer.id === id) ? boxFor(id) : null);
                  }}
                  onMouseLeave={() => setHoverBox(null)}
                  dangerouslySetInnerHTML={{ __html: previewSvg }}
                />
                {hoverBox && <div aria-hidden className="pointer-events-none absolute rounded-sm ring-2 ring-indigo-300" style={{ left: hoverBox.left, top: hoverBox.top, width: hoverBox.width, height: hoverBox.height }} />}
                {activeLayer && activeBox && <div
                  data-testid="svg-inline-editor"
                  className="absolute z-10 flex items-center gap-1.5 rounded-lg border bg-popover p-1.5 shadow-xl"
                  style={editorPosition(activeBox)}
                >
                  <Input
                    autoFocus
                    data-testid={`svg-inline-input-${activeLayer.id}`}
                    aria-label={t("editLayer")}
                    className="h-8 flex-1"
                    value={layerValue(activeLayer)}
                    disabled={Boolean(activeLayer.binding)}
                    onChange={(event) => editLayer(activeLayer.id, event.target.value)}
                    onKeyDown={(event) => {
                      // Escape belongs to the label being edited, not to the dialog
                      // behind it — without this it would close the whole panel.
                      if (event.key === "Escape") { event.stopPropagation(); editLayer(activeLayer.id, escapeValue.current); closeEditor(); }
                      if (event.key === "Enter") { event.stopPropagation(); closeEditor(); }
                      if (event.key === "Tab") { event.preventDefault(); stepLayer(event.shiftKey ? -1 : 1); }
                    }}
                  />
                  <Select value={activeLayer.binding || "fixed"} onValueChange={(value) => bindLayer(activeLayer.id, value === "fixed" ? "" : value ?? "")}>
                    <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("fixedText")}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="fixed">{t("fixedText")}</SelectItem>{variableKeys.map((key) => <SelectItem key={key} value={key}>{`{${key}}`}</SelectItem>)}</SelectContent>
                  </Select>
                  {savedLayer && savedLayer.text !== activeLayer.text && !activeLayer.binding && <Button type="button" size="icon-sm" variant="ghost" title={t("resetLayer")} aria-label={t("resetLayer")} onClick={() => editLayer(activeLayer.id, savedLayer.text)}><RotateCcw className="size-3.5" /></Button>}
                  <Button type="button" size="sm" variant="ghost" onClick={closeEditor}>{t("done")}</Button>
                </div>}
                {activeLayer?.binding && <p className="absolute inset-x-2 bottom-1 text-center text-[11px] text-muted-foreground">{t("boundTo", { field: `{${activeLayer.binding}}` })}</p>}
              </div>
            </div>

            {/* The list is the fallback, not the way in: everything here is reachable in the graphic above. */}
            <div className="border-t">
              <div className="flex items-center gap-2 px-4 py-2">
                <button type="button" aria-expanded={listOpen} onClick={() => setListOpen((value) => !value)} className="flex items-center gap-2 text-sm font-medium">
                  <ChevronDown className={`size-4 text-muted-foreground transition-transform ${listOpen ? "" : "-rotate-90"}`} />
                  <Type className="size-4 text-indigo-600" />{t("allLayers")}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{draft.length}</span>
                </button>
                {error && <p role="alert" className="min-w-0 flex-1 truncate text-xs text-destructive">{error}</p>}
              </div>
              {listOpen && <div className="max-h-[34vh] overflow-y-auto px-4 pb-4">
                <div className="relative mb-2">
                  <Search className="absolute top-2.5 left-2 size-3.5 text-muted-foreground" />
                  <Input className="h-8 pl-7" placeholder={t("searchLayers")} value={query} onChange={(event) => setQuery(event.target.value)} />
                </div>
                {!draft.length ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("noText")}</p>
                  : !visibleLayers.length ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("noMatches")}</p>
                  : <div className="divide-y rounded-lg border">{visibleLayers.map((layer) => <button
                    key={layer.id}
                    type="button"
                    data-testid={`svg-text-layer-${layer.id}`}
                    onClick={() => activate(layer.id)}
                    onMouseEnter={() => setHoverBox(boxFor(layer.id))}
                    onMouseLeave={() => setHoverBox(null)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${activeId === layer.id ? "bg-indigo-50 dark:bg-indigo-950/35" : ""}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{layerValue(layer) || <span className="text-muted-foreground">—</span>}</span>
                    {layer.binding && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{`{${layer.binding}}`}</span>}
                  </button>)}</div>}
                {!!selected.revisions.length && <section className="mt-4 border-t pt-3">
                  <div className="mb-2 flex items-center gap-2"><History className="size-4 text-indigo-600" /><h3 className="text-sm font-semibold">{t("history")}</h3></div>
                  <div className="space-y-1">{selected.revisions.map((revision) => <div key={revision.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/60">
                    <span className="flex-1">{t("version", { version: revision.version })} · {new Date(revision.createdAt).toLocaleString()}</span>
                    <Button type="button" size="xs" variant="ghost" disabled={saving} onClick={() => { if (!dirty || confirm(t("discardConfirm"))) void restore(revision.id); }}><RotateCcw className="size-3.5" />{t("restore")}</Button>
                  </div>)}</div>
                </section>}
                <p className="mt-3 text-[11px] text-muted-foreground">{t("done")}: Esc · {t("save")}: Ctrl+S · {t("editLayer")}: Tab</p>
              </div>}
            </div>
          </div>}
        </div>}
    </DialogContent>
  </Dialog>;
}
