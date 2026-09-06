import type { TiptapNode } from "./tiptap";

export const FIGURE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  svg: "image/svg+xml", svgz: "image/svg+xml",
};
export function figureMime(name: string) { return FIGURE_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? ""; }
export function removeFigureNumberPrefix(caption: string) { return caption.replace(/^\s*(?:abbildung|abb\.|figure|fig\.)\s*(?:\d+|x)(?:\s*[.:—–-]\s*|\s+|$)/i, ""); }
export function stripFigureNumber(caption: string) { return removeFigureNumberPrefix(caption).trim(); }
export function isFigure(type: string | undefined) { return type === "commentableImage" || type === "mermaidDiagram"; }
export function numberedFigure(attrs: Record<string, unknown> = {}) {
  return attrs.numbered !== false && (attrs.numbered === true || attrs.includeInFigureIndex !== false);
}
export type FigureEntry = { nodeId: string; caption: string; number: number; included: boolean; src: string; assetId: string };
export function documentFigures(doc: TiptapNode): FigureEntry[] {
  const figures: FigureEntry[] = [];
  const visit = (node: TiptapNode) => {
    if (isFigure(node.type) && numberedFigure(node.attrs)) figures.push({
      nodeId: String(node.attrs?.nodeId ?? ""), caption: stripFigureNumber(String(node.attrs?.caption ?? "")),
      number: figures.length + 1, included: node.attrs?.includeInFigureIndex !== false,
      src: node.type === "mermaidDiagram" && node.attrs?.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(node.attrs.svg))}` : String(node.attrs?.src ?? ""), assetId: String(node.attrs?.assetId ?? ""),
    });
    node.content?.forEach(visit);
  };
  visit(doc);
  return figures;
}
export function hasFigureList(doc: TiptapNode): boolean {
  return doc.type === "figureList" || Boolean(doc.content?.some(hasFigureList));
}
export function relativeFigurePath(input: string, prefix = "") {
  let value = input.trim().replace(/\\/g, "/");
  const base = prefix.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (base && (value.toLowerCase().startsWith(`${base.toLowerCase()}/`))) value = value.slice(base.length + 1);
  if (!value || value.length > 1000 || /[\u0000-\u001f:]/.test(value) || value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("invalidPath");
  return value;
}
export type FigureCrop = { x: number; y: number; width: number; height: number };
const finite = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export function figureCrop(value: unknown): FigureCrop {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const x = Math.max(0, Math.min(0.95, finite(input.x, 0)));
  const y = Math.max(0, Math.min(0.95, finite(input.y, 0)));
  return { x, y, width: Math.max(0.05, Math.min(1 - x, finite(input.width, 1))), height: Math.max(0.05, Math.min(1 - y, finite(input.height, 1))) };
}
export function cropImageStyle(value: unknown) {
  const crop = figureCrop(value);
  return { width: `${100 / crop.width}%`, maxWidth: "none", transform: `translate(${-crop.x * 100}%, ${-crop.y * 100}%)` };
}
export function figureWidth(value: unknown) { return Math.max(10, Math.min(100, finite(value, 100))); }

export const FIGURE_ATTRIBUTES = {
  nodeId: { default: "" }, assetId: { default: "" }, attachmentId: { default: "" }, src: { default: "" },
  alt: { default: "" }, caption: { default: "" }, numbered: { default: null }, includeInFigureIndex: { default: true },
  widthPercent: { default: 100 }, alignment: { default: "center" }, wrap: { default: "none" },
  crop: { default: null }, aspectRatio: { default: 0 }, cropX: { default: 50 }, cropY: { default: 50 },
};
