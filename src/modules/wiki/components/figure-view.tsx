"use client";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cropImageStyle, figureCrop, figureWidth, numberedFigure, removeFigureNumberPrefix } from "../lib/figure";
import { getDocumentNumberingState } from "./document-extension";
import { useFigures } from "./figure-library";

export function FigureCaptionEditor({ node, editor, updateAttributes }: Pick<NodeViewProps, "node" | "editor" | "updateAttributes">) {
  const t = useTranslations("wiki.figures");
  const [number, setNumber] = useState("");
  const caption = removeFigureNumberPrefix(String(node.attrs.caption ?? ""));
  const numbered = numberedFigure(node.attrs);
  useEffect(() => {
    const update = () => setNumber(getDocumentNumberingState(editor)?.labels.get(String(node.attrs.nodeId)) ?? "");
    update(); editor.on("transaction", update);
    return () => { editor.off("transaction", update); };
  }, [editor, node.attrs.nodeId]);
  if (!numbered && !caption && !editor.isEditable) return null;
  return <figcaption className="wiki-figure-caption" contentEditable={false}>
    {numbered && number && <span className="shrink-0">{number}:</span>}
    {editor.isEditable ? <textarea aria-label={t("caption")} placeholder={t("captionPlaceholder")} value={caption} rows={Math.max(1, Math.ceil(caption.length / 85))}
      onFocus={() => editor.view.dispatch(closeHistory(editor.state.tr))} onBlur={() => editor.view.dispatch(closeHistory(editor.state.tr))}
      onChange={(event) => updateAttributes({ caption: event.target.value })} onKeyDown={(event) => event.stopPropagation()} className="wiki-figure-caption-input" /> : <span>{caption}</span>}
  </figcaption>;
}

export function FigureView(props: NodeViewProps & { imageSrc?: string; children?: ReactNode }) {
  const { node, editor, selected, updateAttributes, getPos } = props;
  const t = useTranslations("wiki.figures");
  const library = useFigures();
  const asset = library?.manifest.assets.find((item) => item.id === node.attrs.assetId);
  const src = props.imageSrc ?? asset?.src ?? String(node.attrs.src ?? "");
  const [ratio, setRatio] = useState(Number(node.attrs.aspectRatio) || 1.5);
  const [cropOpen, setCropOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [resizing, setResizing] = useState<number | null>(null);
  const resize = useRef<{ start: number; width: number; container: number } | null>(null);
  const figure = useRef<HTMLElement | null>(null);
  const width = resizing ?? figureWidth(node.attrs.widthPercent);
  const crop = figureCrop(node.attrs.crop);
  const wrap = node.attrs.wrap === "left" || node.attrs.wrap === "right" ? node.attrs.wrap : "none";
  const alignment = node.attrs.alignment === "left" || node.attrs.alignment === "right" ? node.attrs.alignment : "center";
  const editable = editor.isEditable;
  const select = () => { const pos = getPos(); if (pos !== undefined) { editor.view.dispatch(closeHistory(editor.state.tr)); editor.chain().focus().setNodeSelection(pos).run(); } };
  const finish = () => {
    const pos = getPos(); if (pos === undefined) return;
    const transaction = closeHistory(editor.state.tr);
    const after = pos + node.nodeSize;
    if (after === transaction.doc.content.size) transaction.insert(after, editor.schema.nodes.paragraph.create());
    editor.view.dispatch(transaction.setSelection(TextSelection.near(transaction.doc.resolve(after), 1)));
    editor.view.focus();
  };
  function startResize(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault(); event.stopPropagation(); select();
    const bounds = figure.current?.getBoundingClientRect();
    if (!bounds) return;
    resize.current = { start: event.clientX, width, container: bounds.width / (width / 100) };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveResize(event: PointerEvent<HTMLButtonElement>) {
    const state = resize.current;
    if (!state) return;
    setResizing(figureWidth(state.width + (event.clientX - state.start) / state.container * 100));
  }
  function finishResize() {
    if (resizing !== null && editor.isEditable) updateAttributes({ widthPercent: Math.round(resizing) });
    resize.current = null; setResizing(null);
  }
  return <NodeViewWrapper as="figure" ref={figure} data-commentable-image="" data-figure-view="" data-comment-node-id={node.attrs.nodeId} data-attachment-id={node.attrs.attachmentId}
    data-image-alignment={alignment} data-figure-wrap={wrap} data-keep-together=""
    className={`wiki-commentable-media wiki-editable-figure${selected ? " is-selected" : ""}`}
    style={{ width: `${width}%`, maxWidth: `min(100%, calc(var(--figure-available-height, 200mm) * ${ratio * crop.width / crop.height}))`, float: wrap === "none" ? undefined : wrap, clear: wrap === "none" ? "both" : wrap,
      marginLeft: wrap === "right" ? "1em" : alignment === "left" ? 0 : "auto", marginRight: wrap === "left" ? "1em" : alignment === "right" ? 0 : "auto" }}>
    <div className="wiki-figure-artwork" contentEditable={false} style={{ aspectRatio: ratio * crop.width / crop.height }} onMouseDown={(event) => { if (event.target instanceof HTMLImageElement) { event.preventDefault(); event.stopPropagation(); select(); } }} onClick={(event) => { if (event.target instanceof HTMLImageElement) { event.stopPropagation(); select(); } }}>
      {/* Authenticated artwork is rendered directly, including SVG and immutable linked revisions. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={String(node.attrs.alt || "")} draggable={false} style={cropImageStyle(crop)} onLoad={(event) => { setLoadError(false); if (event.currentTarget.naturalWidth) setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight); }} onError={() => setLoadError(true)} />
      {loadError && <span className="absolute inset-0 grid place-items-center bg-muted text-sm">{t("imageUnavailable")}</span>}
      {selected && editable && <>
        <button type="button" data-drag-handle className="wiki-figure-move" aria-label={t("move")} title={t("move")}>⠿</button>
        <button type="button" className="wiki-figure-resize" aria-label={t("resize")} onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={finishResize} onPointerCancel={() => { resize.current = null; setResizing(null); }}
          onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); updateAttributes({ widthPercent: figureWidth(width + (event.key === "ArrowRight" ? 5 : -5)) }); } }} />
      </>}
    </div>
    <FigureCaptionEditor {...props} />
    {selected && editable && <div className="wiki-figure-controls" contentEditable={false} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); finish(); } }}>
      <div className="flex flex-wrap items-center gap-1">
        <label className="flex items-center gap-1 text-xs">{t("width")}<Input className="h-7 w-16" type="number" min={10} max={100} value={Math.round(width)} onChange={(event) => updateAttributes({ widthPercent: figureWidth(event.target.value) })} />%</label>
        <select aria-label={t("layout")} value={wrap === "none" ? alignment : `wrap-${wrap}`} onChange={(event) => { const value = event.target.value; updateAttributes({ wrap: value.startsWith("wrap-") ? value.slice(5) : "none", alignment: value.replace("wrap-", ""), ...(value.startsWith("wrap-") && width > 70 ? { widthPercent: 50 } : {}) }); }} className="h-7 rounded border bg-background text-xs">
          <option value="left">{t("left")}</option><option value="center">{t("center")}</option><option value="right">{t("right")}</option><option value="wrap-left">{t("wrapLeft")}</option><option value="wrap-right">{t("wrapRight")}</option>
        </select>
        <Button type="button" size="xs" variant="ghost" onClick={() => setCropOpen(!cropOpen)}>{t("crop")}</Button>
        {node.type.name === "commentableImage" && <Button type="button" size="xs" variant="ghost" onClick={() => library?.replace?.(String(node.attrs.nodeId))}>{t("replace")}</Button>}
        <Button type="button" size="xs" variant="ghost" onClick={() => setDetailsOpen(!detailsOpen)}>{t("details")}</Button>
        {asset?.mimeType === "image/svg+xml" && <Button type="button" size="xs" variant="ghost" onClick={() => library?.editArtwork?.(String(node.attrs.nodeId))}>{t("editSvg")}</Button>}
        {asset?.sourceId && <Button type="button" size="xs" variant="ghost" onClick={() => library?.editSource?.(String(node.attrs.nodeId))}>{t("source")}</Button>}
        <Button type="button" size="xs" variant="outline" className="ml-auto" onClick={finish}>{t("done")}</Button>
      </div>
      {cropOpen && <div className="grid grid-cols-2 gap-2 border-t pt-2">
        {(["x", "y", "width", "height"] as const).map((key) => <label key={key} className="flex items-center gap-2 text-xs">{t(`crop${key[0].toUpperCase()}${key.slice(1)}` as "cropX")}<Input type="number" min={key === "width" || key === "height" ? 5 : 0} max={100} value={Math.round(crop[key] * 100)} onChange={(event) => updateAttributes({ crop: figureCrop({ ...crop, [key]: Number(event.target.value) / 100 }) })} /></label>)}
        <Button type="button" size="xs" variant="outline" onClick={() => updateAttributes({ crop: null })}>{t("resetCrop")}</Button>
      </div>}
      {detailsOpen && <div className="space-y-2 border-t pt-2">
        <label className="block text-xs">{t("alt")}<Input value={String(node.attrs.alt ?? "")} onChange={(event) => updateAttributes({ alt: event.target.value })} /></label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!numberedFigure(node.attrs)} onChange={(event) => updateAttributes({ numbered: !event.target.checked, includeInFigureIndex: !event.target.checked })} />{t("decorative")}</label>
        {numberedFigure(node.attrs) && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={node.attrs.includeInFigureIndex !== false} onChange={(event) => updateAttributes({ includeInFigureIndex: event.target.checked })} />{t("include")}</label>}
      </div>}
    </div>}
    {props.children}
    {asset?.sourceId && <div className="wiki-figure-source-status" contentEditable={false}>{asset.relativePath} · {t(asset.paused ? "paused" : library?.failures[asset.id] || asset.status !== "ready" ? "sourceUnavailable" : "live")}</div>}
  </NodeViewWrapper>;
}
