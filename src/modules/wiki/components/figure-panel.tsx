"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { useTranslations } from "next-intl";
import { AlignCenter, AlignLeft, AlignRight, Check, Crop, Image as ImageIcon, MessageSquareText, Replace, RotateCcw, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { figureCrop, figureWidth, numberedFigure, type FigureCrop } from "../lib/figure";
import { transformFigureCrop, type CropHandle } from "../lib/figure-transform";
import { useFigures } from "./figure-library";

function CropPreview({ src, value, onApply }: { src: string; value: unknown; onApply: (crop: FigureCrop | null) => void }) {
  const t = useTranslations("wiki.figures");
  const [draft, setDraft] = useState(() => figureCrop(value));
  const preview = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; width: number; height: number; crop: FigureCrop; handle: CropHandle } | null>(null);
  function start(event: PointerEvent<HTMLButtonElement>, handle: CropHandle) {
    const bounds = preview.current?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    gesture.current = { x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height, crop: draft, handle };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const state = gesture.current;
    if (state) setDraft(transformFigureCrop(state.crop, state.handle, (event.clientX - state.x) / state.width, (event.clientY - state.y) / state.height));
  }
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">{t("cropHint")}</p>
    <div ref={preview} className="wiki-crop-preview">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" draggable={false} />
      <div className="wiki-crop-box" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }}>
        {(["move", "nw", "ne", "sw", "se"] as const).map((handle) => <button key={handle} type="button" className={`wiki-crop-handle wiki-crop-${handle}`} aria-label={t(`cropHandle.${handle}`)}
          onPointerDown={(event) => start(event, handle)} onPointerMove={move} onPointerUp={() => { gesture.current = null; }} onPointerCancel={() => { if (gesture.current) setDraft(gesture.current.crop); gesture.current = null; }}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const step = event.shiftKey ? 0.1 : 0.01;
            setDraft(transformFigureCrop(draft, handle, event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0));
          }} />)}
      </div>
    </div>
    <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">{t("preciseCrop")}</summary><div className="mt-3 grid grid-cols-2 gap-2">
      {(["x", "y", "width", "height"] as const).map((key) => <label key={key} className="grid gap-1">{t(`crop${key[0].toUpperCase()}${key.slice(1)}` as "cropX")}<Input type="number" min={key === "width" || key === "height" ? 5 : 0} max={100} value={Math.round(draft[key] * 100)} onChange={(event) => setDraft(figureCrop({ ...draft, [key]: Number(event.target.value) / 100 }))} /></label>)}
    </div></details>
    <div className="grid gap-2"><Button size="sm" onClick={() => onApply(draft)}><Check />{t("applyCrop")}</Button><Button size="sm" variant="outline" onClick={() => onApply(null)}><RotateCcw />{t("resetCrop")}</Button></div>
  </div>;
}

export function FigurePanel({ editor, node, onComment }: { editor: Editor; node: ProseMirrorNode; onComment: (mode: "whole" | "region") => void }) {
  const t = useTranslations("wiki.figures");
  const wiki = useTranslations("wiki");
  const library = useFigures();
  const [cropOpen, setCropOpen] = useState(false);
  const asset = library?.manifest.assets.find((item) => item.id === node.attrs.assetId);
  const src = asset?.src ?? String(node.attrs.src ?? "");
  const image = node.type.name === "commentableImage";
  const width = figureWidth(node.attrs.widthPercent);
  const wrap = String(node.attrs.wrap ?? "none");
  const alignment = String(node.attrs.alignment ?? "center");
  // Controls never restore an old selection or modify a different figure.
  function update(attrs: Record<string, unknown>) {
    const selection = editor.state.selection;
    if (!editor.isEditable || !(selection instanceof NodeSelection) || selection.node.attrs.nodeId !== node.attrs.nodeId) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(selection.from, undefined, { ...selection.node.attrs, ...attrs }));
  }
  function finish() {
    const selection = editor.state.selection;
    const transaction = closeHistory(editor.state.tr);
    const after = selection.to;
    if (after === transaction.doc.content.size && editor.isEditable) transaction.insert(after, editor.schema.nodes.paragraph.create());
    editor.view.dispatch(transaction.setSelection(TextSelection.near(transaction.doc.resolve(after), 1)));
    editor.view.focus();
  }
  return <aside data-testid="figure-panel" aria-label={t("panelTitle")} className="wiki-figure-panel min-w-0 sticky top-16 max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-xl border bg-background shadow-sm"
    onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); if (cropOpen) setCropOpen(false); else finish(); } }}>
    <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background p-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><ImageIcon className="size-4 text-muted-foreground" />{t("panelTitle")}</h2><Button size="sm" variant="ghost" onClick={finish}>{t("done")}</Button></div>
    <div className="divide-y px-4">
      {image && <fieldset disabled={!editor.isEditable} className="min-w-0 space-y-4 py-4">
        <legend className="sr-only">{t("layout")}</legend>
        <div className="flex items-center justify-between"><label htmlFor="figure-width" className="text-xs font-medium">{t("width")}</label><div className="flex items-center gap-1 text-xs"><Input id="figure-width" className="h-8 w-20" type="number" min={10} max={100} value={Math.round(width)} onChange={(event) => update({ widthPercent: figureWidth(event.target.value) })} />%</div></div>
        <input aria-label={t("resize")} className="w-full accent-primary" type="range" min={10} max={100} value={width} onChange={(event) => update({ widthPercent: Number(event.target.value) })} />
        <div className="flex gap-1">{[25, 50, 75, 100].map((size) => <Button key={size} size="sm" variant={width === size ? "secondary" : "outline"} className="flex-1" onClick={() => update({ widthPercent: size })}>{size}%</Button>)}</div>
        <div className="grid grid-cols-3 gap-1">{([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([value, Icon]) => <Button key={value} size="sm" variant={alignment === value && wrap === "none" ? "secondary" : "outline"} aria-label={t(value)} title={t(value)} aria-pressed={alignment === value && wrap === "none"} onClick={() => update({ alignment: value, wrap: "none" })}><Icon /></Button>)}</div>
        <label className="grid gap-2 text-xs font-medium">{t("textWrap")}<select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={wrap} onChange={(event) => update({ wrap: event.target.value, ...(event.target.value !== "none" ? { alignment: event.target.value, ...(width > 70 ? { widthPercent: 50 } : {}) } : {}) })}><option value="none">{t("noWrap")}</option><option value="left">{t("wrapLeft")}</option><option value="right">{t("wrapRight")}</option></select></label>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("moveHint")}</p>
        <Button className="w-full justify-start" size="sm" variant={cropOpen ? "secondary" : "outline"} aria-expanded={cropOpen} onClick={() => setCropOpen(!cropOpen)}><Crop />{t("crop")}</Button>
        {cropOpen && <CropPreview key={JSON.stringify(node.attrs.crop)} src={src} value={node.attrs.crop} onApply={(crop) => { editor.view.dispatch(closeHistory(editor.state.tr)); update({ crop }); editor.view.dispatch(closeHistory(editor.state.tr)); setCropOpen(false); }} />}
      </fieldset>}
      {image && <fieldset disabled={!editor.isEditable} className="min-w-0 space-y-3 py-4">
        <label className="grid gap-2 text-xs font-medium">{t("alt")}<Input value={String(node.attrs.alt ?? "")} onChange={(event) => update({ alt: event.target.value })} /></label>
        <p className="text-xs text-muted-foreground">{t("captionHint")}</p>
        <label className="flex items-start gap-2 text-xs"><input className="accent-primary" type="checkbox" checked={!numberedFigure(node.attrs)} onChange={(event) => update({ numbered: !event.target.checked, includeInFigureIndex: !event.target.checked })} />{t("decorative")}</label>
        {numberedFigure(node.attrs) && <label className="flex items-start gap-2 text-xs"><input className="accent-primary" type="checkbox" checked={node.attrs.includeInFigureIndex !== false} onChange={(event) => update({ numbered: true, includeInFigureIndex: event.target.checked })} />{t("include")}</label>}
      </fieldset>}
      <div className="grid gap-2 py-4">
        <Button size="sm" variant="outline" className="justify-start" onClick={() => onComment("whole")}><MessageSquareText />{wiki("commentWholeImage")}</Button>
        <Button size="sm" variant="outline" className="justify-start" onClick={() => onComment("region")}><Scan />{wiki("selectImageRegion")}</Button>
        {image && <Button size="sm" variant="outline" disabled={!editor.isEditable} className="justify-start" onClick={() => library?.replace?.(String(node.attrs.nodeId))}><Replace />{t("replace")}</Button>}
        {image && (asset?.mimeType === "image/svg+xml" || /\.svg(?:\?|$)/i.test(src)) && <Button size="sm" variant="outline" disabled={!editor.isEditable} onClick={() => library?.editArtwork?.(String(node.attrs.nodeId))}>{t("editSvg")}</Button>}
        {asset?.sourceId && <Button size="sm" variant="outline" onClick={() => library?.editSource?.(String(node.attrs.nodeId))}>{t("source")}</Button>}
      </div>
    </div>
  </aside>;
}
