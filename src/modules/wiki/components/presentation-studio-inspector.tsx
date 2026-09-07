"use client";

import { createId } from "@paralleldrive/cuid2";
import { useTranslations } from "next-intl";
import { ColorPicker } from "@/components/ui/color-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { groupPresentationElements, ungroupPresentationElements, presentationDescendants, presentationFonts, presentationIconNames, isPresentationElementLocked, type PresentationElement, type PresentationStep } from "../lib/presentation";
import { PresentationRichText } from "./presentation-rich-text";

const selectClass = "mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm";

export function PresentationStudioInspector({ elements, selectedIds, activeStep, onElements, onSelect, onUpdate, onSteps, onAdd, onUpload, disabled }: {
  elements: PresentationElement[]; selectedIds: string[]; activeStep: PresentationStep | null;
  onElements: (update: (elements: PresentationElement[]) => PresentationElement[]) => void;
  onSelect: (ids: string[]) => void; onUpdate: (element: PresentationElement) => void;
  onSteps: (update: (steps: PresentationStep[]) => PresentationStep[]) => void;
  onAdd: (type: "chart" | "icon") => void; onUpload: (file: File) => void; disabled: boolean;
}) {
  const t = useTranslations("presentationStudio");
  const selected = selectedIds.length === 1 ? elements.find((element) => element.id === selectedIds[0]) : undefined;
  const descendants = presentationDescendants(elements, new Set(selectedIds));
  const locked = selected ? isPresentationElementLocked(elements, selected.id) : false;
  const content = (patch: Record<string, unknown>) => selected && onUpdate({ ...selected, content: { ...selected.content, ...patch } } as PresentationElement);
  return <div className="mb-4 space-y-3 border-b pb-4">
    <details open className="space-y-2"><summary className="cursor-pointer text-sm font-semibold">{t("structure")}</summary>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" type="button" disabled={disabled || selectedIds.length < 2 || elements.length >= 500} onClick={() => {
          const id = createId(); onElements((current) => groupPresentationElements(current, new Set(selectedIds), id)); onSelect([id]);
        }}>{t("group")}</Button>
        {selected?.type === "frame" && selected.content.isGroup && <Button size="sm" variant="outline" type="button" disabled={disabled || locked} onClick={() => {
          onElements((current) => ungroupPresentationElements(current, selected.id)); onSteps((steps) => steps.filter((step) => step.elementId !== selected.id)); onSelect([]);
        }}>{t("ungroup")}</Button>}
        {selected && <Button type="button" size="sm" variant="outline" disabled={disabled || (!selected.locked && locked)} onClick={() => onElements((current) => current.map((element) => element.id === selected.id ? { ...element, locked: !element.locked } : element))}>{selected.locked ? t("unlock") : t("lock")}</Button>}
      </div>
      {selected && <label className="block text-xs">{t("parentFrame")}
        <select className={selectClass} value={selected.parentId ?? ""} disabled={disabled || locked} onChange={(event) => onUpdate({ ...selected, parentId: event.target.value || undefined })}>
          <option value="">{t("noParent")}</option>
          {elements.filter((element) => element.type === "frame" && !descendants.has(element.id) && !isPresentationElementLocked(elements, element.id)).map((element, index) => <option key={element.id} value={element.id}>{element.type === "frame" && element.content.label || `${t("frame")} ${index + 1}`}</option>)}
        </select>
      </label>}
      {selected?.type === "frame" && !locked && <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onElements((current) => current.map((element) => {
        if (element.id === selected.id || element.parentId || isPresentationElementLocked(current, element.id) || presentationDescendants(current, new Set([element.id])).has(selected.id)) return element;
        return element.x >= selected.x && element.y >= selected.y && element.x + element.width <= selected.x + selected.width && element.y + element.height <= selected.y + selected.height ? { ...element, parentId: selected.id } : element;
      }))}>{t("attachContents")}</Button>}
      <label className="block text-xs">{t("selectObject")}
        <select className={selectClass} value={selected?.id ?? ""} onChange={(event) => onSelect(event.target.value ? [event.target.value] : [])}>
          <option value="">{t("selectObject")}</option>
          {elements.map((element, index) => <option key={element.id} value={element.id}>{element.locked ? "🔒 " : ""}{element.parentId ? "↳ " : ""}{element.type === "text" ? element.content.text.slice(0, 28) : element.type === "frame" ? element.content.label || t("frame") : t(element.type)} {index + 1}</option>)}
        </select>
      </label>
    </details>
    <details className="space-y-3" open={Boolean(selected && ["text", "image", "chart", "icon", "audio", "video"].includes(selected.type))}>
      <summary className="cursor-pointer text-sm font-semibold">{t("content")}</summary>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" type="button" disabled={disabled} onClick={() => onAdd("chart")}>{t("addChart")}</Button>
        <Button size="sm" variant="outline" type="button" disabled={disabled} onClick={() => onAdd("icon")}>{t("addIcon")}</Button>
        <label className="block w-full text-xs">{t("uploadMedia")}<input className="mt-1 block w-full text-xs" type="file" accept="video/mp4,video/webm,audio/mpeg,audio/mp4,audio/ogg,audio/wav" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ""; }} /></label>
      </div>
      <fieldset disabled={disabled || locked} className="space-y-3">
      {selected?.type === "text" && <>
        <PresentationRichText key={selected.id} content={selected.content} disabled={disabled || locked} onChange={(next) => onUpdate({ ...selected, content: next })} />
        <label className="block text-xs">{t("font")}<select className={selectClass} value={selected.content.font ?? "sans"} onChange={(event) => content({ font: event.target.value })}>{presentationFonts.map((font) => <option key={font} value={font}>{t(`fonts.${font}`)}</option>)}</select></label>
        <label className="block text-xs">{t("listStyle")}<select className={selectClass} value={selected.content.list ?? "none"} onChange={(event) => content({ list: event.target.value })}>{["none", "bullet", "number"].map((list) => <option key={list} value={list}>{t(list)}</option>)}</select></label>
      </>}
      {selected?.type === "image" && <>
        <label className="block text-xs">{t("imageFit")}<select className={selectClass} value={selected.content.fit ?? "contain"} onChange={(event) => content({ fit: event.target.value })}><option value="contain">{t("contain")}</option><option value="cover">{t("cover")}</option></select></label>
        <label className="block text-xs">{t("mask")}<select className={selectClass} value={selected.content.mask ?? "none"} onChange={(event) => content({ mask: event.target.value })}>{["none", "circle", "rounded", "diamond"].map((mask) => <option key={mask} value={mask}>{t(mask)}</option>)}</select></label>
        {(["cropX", "cropY", "zoom"] as const).map((key) => <label key={key} className="block text-xs">{t(key)}<input className="mt-1 w-full" type="range" min={key === "zoom" ? 1 : 0} max={key === "zoom" ? 5 : 100} step={key === "zoom" ? 0.1 : 1} value={selected.content[key] ?? (key === "zoom" ? 1 : 50)} onChange={(event) => content({ [key]: Number(event.target.value) })} /></label>)}
      </>}
      {selected?.type === "chart" && <>
        <label className="block text-xs">{t("chartTitle")}<Input value={selected.content.title} maxLength={200} onChange={(event) => content({ title: event.target.value })} /></label>
        <label className="block text-xs">{t("chartType")}<select className={selectClass} value={selected.content.kind} onChange={(event) => content({ kind: event.target.value })}>{["bar", "line", "pie"].map((kind) => <option key={kind} value={kind}>{t(kind)}</option>)}</select></label>
        {selected.content.kind === "pie" && <p className="text-xs text-muted-foreground">{t("pieHint")}</p>}
        <div className="space-y-1">{selected.content.data.map((point, index) => <div className="flex gap-1" key={index}>
          <Input aria-label={t("dataLabel")} value={point.label} maxLength={100} onChange={(event) => content({ data: selected.content.data.map((p, i) => i === index ? { ...p, label: event.target.value } : p) })} />
          <input className="w-24 rounded-md border px-2 text-sm" aria-label={t("dataValue")} type="number" defaultValue={point.value} key={`${selected.id}-${index}-${point.value}`} onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && Math.abs(value) <= 1e12) content({ data: selected.content.data.map((p, i) => i === index ? { ...p, value } : p) }); }} />
          <Button type="button" variant="ghost" size="sm" aria-label={t("removePoint")} disabled={selected.content.data.length <= 1} onClick={() => content({ data: selected.content.data.filter((_, i) => i !== index) })}>×</Button>
        </div>)}</div>
        <Button type="button" size="sm" variant="outline" disabled={selected.content.data.length >= 50} onClick={() => content({ data: [...selected.content.data, { label: t("newPoint"), value: 0 }] })}>{t("addPoint")}</Button>
        <label className="block text-xs">{t("color")}<ColorPicker disabled={disabled || locked} aria-label={t("color")} value={selected.content.color || "#6366f1"} onChange={(color) => content({ color })} /></label>
      </>}
      {selected?.type === "icon" && <><label className="block text-xs">{t("icon")}<select className={selectClass} value={selected.content.name} onChange={(event) => content({ name: event.target.value })}>{presentationIconNames.map((name) => <option key={name} value={name}>{t(`icons.${name}`)}</option>)}</select></label><label className="block text-xs">{t("color")}<ColorPicker disabled={disabled || locked} aria-label={t("color")} value={selected.content.color || "#6366f1"} onChange={(color) => content({ color })} /></label></>}
      {(selected?.type === "video" || selected?.type === "audio") && <><label className="block text-xs">{t("mediaTitle")}<Input value={selected.content.title} maxLength={500} onChange={(event) => content({ title: event.target.value })} /></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(selected.content.loop)} onChange={(event) => content({ loop: event.target.checked })} />{t("loopMedia")}</label></>}
      </fieldset>
    </details>
    <details className="space-y-3" open={Boolean(activeStep?.action && activeStep.action !== "camera")}><summary className="cursor-pointer text-sm font-semibold">{t("animation")}</summary>
      <p className="text-xs text-muted-foreground">{t("animationHint")}</p>
      <div className="flex gap-2">{(["fadeIn", "fadeOut"] as const).map((action) => <Button key={action} type="button" size="sm" variant="outline" disabled={disabled || !selected} onClick={() => {
        if (!selected) return;
        const id = createId();
        onSteps((steps) => { if (steps.length >= 500) return steps; const at = activeStep ? steps.findIndex((step) => step.id === activeStep.id) + 1 : steps.length; const next = [...steps]; next.splice(at, 0, { id, elementId: selected.id, action, animationMs: 300 }); return next; });
      }}>{t(action)}</Button>)}</div>
      {activeStep && <><label className="block text-xs">{t("stepAction")}<select className={selectClass} disabled={disabled} value={activeStep.action ?? "camera"} onChange={(event) => onSteps((steps) => steps.map((step) => step.id === activeStep.id ? { ...step, action: event.target.value as PresentationStep["action"] } : step))}>{["camera", "fadeIn", "fadeOut"].map((action) => <option key={action} value={action}>{t(action)}</option>)}</select></label>
        <label className="block text-xs">{t("animationDuration")}<input className={selectClass} type="number" min={0} max={5000} step={100} value={activeStep.animationMs ?? 300} onChange={(event) => { const animationMs = Number(event.target.value); if (Number.isFinite(animationMs)) onSteps((steps) => steps.map((step) => step.id === activeStep.id ? { ...step, animationMs: Math.round(Math.min(5000, Math.max(0, animationMs))) } : step)); }} /></label></>}
    </details>
  </div>;
}
