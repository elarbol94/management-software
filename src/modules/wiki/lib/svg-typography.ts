import type { DocumentSettingsV1 } from "./document-settings";
import { wikiFontStack } from "./wiki-typography";

const PX_PER_PT = 96 / 72;
const PX_PER_MM = 96 / 25.4;
const PAGE_WIDTH_MM = { A4: 210, Letter: 215.9 } as const;
const PAGE_HEIGHT_MM = { A4: 297, Letter: 279.4 } as const;

/**
 * Reads an SVG font-size into user units. Only absolute units are usable:
 * em/%/rem depend on an inherited size we cannot resolve without layout.
 */
export function parseFontSize(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^\s*(-?[\d.]+)\s*(px|pt|mm|cm|in|pc)?\s*$/i.exec(value);
  if (!match) return null;
  const size = Number(match[1]);
  if (!Number.isFinite(size) || size <= 0) return null;
  const unit = match[2]?.toLowerCase();
  if (!unit || unit === "px") return size;
  if (unit === "pt") return size * PX_PER_PT;
  if (unit === "mm") return size * PX_PER_MM;
  if (unit === "cm") return size * PX_PER_MM * 10;
  if (unit === "in") return size * 96;
  return size * 16; // pc
}

/** Reads a property out of an inline style attribute. */
export function readStyleProperty(style: string | null | undefined, property: string) {
  if (!style) return null;
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i").exec(style);
  return match ? match[1].trim() : null;
}

/** Replaces a property inside an inline style attribute, appending it when absent. */
export function writeStyleProperty(style: string | null | undefined, property: string, value: string) {
  const declaration = `${property}:${value}`;
  if (!style?.trim()) return declaration;
  if (!readStyleProperty(style, property)) return `${style.replace(/;\s*$/, "")};${declaration}`;
  return style.replace(new RegExp(`((?:^|;)\\s*${property}\\s*:\\s*)([^;]+)`, "i"), `$1${value}`);
}

/**
 * The size most of the diagram's labels use. The median keeps a handful of
 * oversized titles from dragging the whole diagram down a scale step.
 */
export function dominantFontSize(sizes: number[]): number | null {
  const usable = sizes.filter((size) => Number.isFinite(size) && size > 0).sort((first, second) => first - second);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
}

/** Printable width of the page body, i.e. the widest a diagram may be drawn. */
export function contentWidthMm(page: DocumentSettingsV1["page"]) {
  const sizes = page.orientation === "landscape" ? PAGE_HEIGHT_MM : PAGE_WIDTH_MM;
  return Math.max(20, sizes[page.size] - page.marginsMm.left - page.marginsMm.right);
}

/**
 * Display width that makes the diagram's own label size land on the document's
 * body size. Scaling the whole drawing keeps the artwork's layout intact —
 * rewriting each font-size would move text off the shapes it belongs to.
 */
export function diagramDisplayWidthPx(input: {
  viewBoxWidth: number;
  dominantSize: number;
  bodySizePt: number;
  contentWidthMm: number;
  sizeScale: number;
}) {
  const { viewBoxWidth, dominantSize, bodySizePt, sizeScale } = input;
  if (!(viewBoxWidth > 0) || !(dominantSize > 0)) return null;
  const targetPx = bodySizePt * PX_PER_PT;
  const width = viewBoxWidth * (targetPx / dominantSize) * sizeScale;
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.min(width, input.contentWidthMm * PX_PER_MM);
}

/**
 * Multiplies a font-size in place, keeping the unit the author wrote so the
 * value stays readable and any unit-sensitive tooling still recognises it.
 */
export function scaleFontSizeValue(value: string | null | undefined, factor: number): string | null {
  if (!value || !Number.isFinite(factor) || factor <= 0) return null;
  const match = /^\s*(-?[\d.]+)\s*(px|pt|mm|cm|in|pc)?\s*$/i.exec(value);
  if (!match) return null;
  const size = Number(match[1]);
  if (!Number.isFinite(size) || size <= 0) return null;
  return `${Math.round(size * factor * 1000) / 1000}${match[2] ?? ""}`;
}

/** Parses the four viewBox numbers; diagrams without one cannot be scaled. */
export function parseViewBox(value: string | null | undefined) {
  if (!value) return null;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [, , width, height] = parts;
  return width > 0 && height > 0 ? { width, height } : null;
}

export type SvgElement = {
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
};
export type SvgDocument = {
  documentElement: SvgElement | null;
  getElementsByTagName: (name: string) => ArrayLike<SvgElement>;
};

/** The two writing-style values a diagram can be matched to. */
export type DiagramTypographyTarget = Pick<DocumentSettingsV1["theme"], "bodyFont" | "bodySizePt">;

/** What "Diagramme nutzen die Dokumentschrift" resolves to, for showing it in the UI. */
export function diagramTypographyTarget(
  settings: DocumentSettingsV1,
  typography?: DiagramTypographyTarget | null,
): DiagramTypographyTarget {
  return { ...settings.theme, ...(typography ?? {}) };
}

function collectFontSizes(elements: SvgElement[]) {
  return elements.flatMap((element) => {
    const size = parseFontSize(
      element.getAttribute("font-size") ?? readStyleProperty(element.getAttribute("style"), "font-size"),
    );
    return size ? [size] : [];
  });
}

/**
 * Applies the document's typography at render time. The stored SVG is never
 * touched, so turning this off restores the original artwork and a folder sync
 * does not fight it.
 */
export function applyDocumentTypography(
  document: SvgDocument,
  elements: SvgElement[],
  settings: DocumentSettingsV1,
  /** Per-graphic override of the document multiplier, when that graphic needs to disagree. */
  sizeScaleOverride?: number | null,
  /**
   * The writing style the document body is actually drawn with. `settings.theme`
   * only holds what a template once stored — the page renders from the author's
   * personal Schreibbild — so matching against the theme would size diagrams to a
   * font the reader never sees.
   */
  typography?: DiagramTypographyTarget | null,
) {
  const { diagrams } = settings;
  const theme = { ...settings.theme, ...(typography ?? {}) };
  if (diagrams.matchFont) {
    const stack = wikiFontStack(theme.bodyFont);
    for (const element of elements) {
      element.setAttribute("font-family", stack);
      // An inline style beats the presentation attribute, so it has to be rewritten too.
      const style = element.getAttribute("style");
      if (style && readStyleProperty(style, "font-family")) {
        element.setAttribute("style", writeStyleProperty(style, "font-family", stack));
      }
    }
  }
  if (diagrams.sizeMode === "off") return;
  const sizeScale = typeof sizeScaleOverride === "number" && sizeScaleOverride > 0
    ? sizeScaleOverride
    : diagrams.sizeScale;
  const root = document.documentElement;
  const viewBox = parseViewBox(root?.getAttribute("viewBox"));
  // Inkscape often carries the size on a parent group instead of the label itself.
  const inherited = [...Array.from(document.getElementsByTagName("g")), ...(root ? [root] : [])];
  const ownSizes = collectFontSizes(elements);
  const dominantSize = dominantFontSize(ownSizes.length ? ownSizes : collectFontSizes(inherited));
  if (!dominantSize) return;
  const targetPx = theme.bodySizePt * PX_PER_PT;

  if (diagrams.sizeMode === "rewrite") {
    // Every size moves by the same factor, so the diagram's own hierarchy
    // (titles larger than labels) survives instead of being flattened.
    const factor = (targetPx / dominantSize) * sizeScale;
    for (const element of [...elements, ...inherited]) {
      const attribute = scaleFontSizeValue(element.getAttribute("font-size"), factor);
      if (attribute) element.setAttribute("font-size", attribute);
      const style = element.getAttribute("style");
      const styled = scaleFontSizeValue(readStyleProperty(style, "font-size"), factor);
      if (styled) element.setAttribute("style", writeStyleProperty(style, "font-size", styled));
    }
    return;
  }

  if (!root || !viewBox) return;
  const width = diagramDisplayWidthPx({
    viewBoxWidth: viewBox.width,
    dominantSize,
    bodySizePt: theme.bodySizePt,
    contentWidthMm: contentWidthMm(settings.page),
    sizeScale,
  });
  if (!width) return;
  const round = (value: number) => String(Math.round(value * 100) / 100);
  root.setAttribute("width", round(width));
  root.setAttribute("height", round(width * viewBox.height / viewBox.width));
}
