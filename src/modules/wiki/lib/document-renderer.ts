import {
  collectDocumentPreflightIssues,
  normalizeDocumentSettings,
  resolveDocumentToken,
  type DocumentPreflightIssue,
  type DocumentSettingsV1,
} from "./document-settings";
import type { TiptapNode } from "./tiptap";
import { formatIeeeCitation } from "./citations";
import { figureNumberLabel } from "./figure-caption";
import {
  normalizeWikiTypography,
  wikiFontStack,
  type WikiTypographySettingsV1,
} from "./wiki-typography";

const DEFAULT_FIGURE_LABEL = "Figure";

export type DocumentAssetResolver = (input: {
  attachmentId: string;
  src: string;
  alt: string;
}) => Promise<string | null>;

function normalizeDocumentCitations(doc: TiptapNode): TiptapNode {
  const order = new Map<string, number>();
  const visit = (node: TiptapNode): TiptapNode => {
    let attrs = node.attrs;
    if (node.type === "citation" && Array.isArray(node.attrs?.items)) {
      const labels: string[] = [];
      for (const item of node.attrs.items as Array<{ sourceId?: unknown; locator?: unknown }>) {
        if (typeof item.sourceId !== "string") continue;
        if (!order.has(item.sourceId)) order.set(item.sourceId, order.size + 1);
        labels.push(formatIeeeCitation(order.get(item.sourceId)!, typeof item.locator === "string" ? item.locator : undefined));
      }
      if (labels.length) attrs = { ...node.attrs, label: labels.join(", ") };
    }
    return {
      ...node,
      ...(attrs ? { attrs } : {}),
      ...(node.content ? { content: node.content.map(visit) } : {}),
    };
  };
  return visit(doc);
}

export type RenderDocumentInput = {
  title: string;
  doc: TiptapNode;
  settings: DocumentSettingsV1;
  references?: string[];
  resolveAsset?: DocumentAssetResolver;
  typography?: WikiTypographySettingsV1;
  /** Word in front of a figure number, so a German export does not read "Figure 1.". */
  figureLabel?: string;
};

export type RenderedDocument = {
  html: string;
  bodyHtml: string;
  bodyDocumentHtml: string;
  coverDocumentHtml: string | null;
  headerTemplate: string;
  footerTemplate: string;
  issues: DocumentPreflightIssue[];
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(value: unknown) {
  const href = String(value ?? "");
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(href)) return escapeHtml(href);
  return "#";
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function renderMarks(text: string, marks: TiptapNode["marks"]) {
  return (marks ?? []).reduce((html, mark) => {
    switch (mark.type) {
      case "bold": return `<strong>${html}</strong>`;
      case "italic": return `<em>${html}</em>`;
      case "strike": return `<s>${html}</s>`;
      case "underline": return `<u>${html}</u>`;
      case "code": return `<code>${html}</code>`;
      case "highlight": return `<mark>${html}</mark>`;
      case "subscript": return `<sub>${html}</sub>`;
      case "superscript": return `<sup>${html}</sup>`;
      case "link": return `<a href="${safeHref(mark.attrs?.href)}">${html}</a>`;
      // Comment/search marks are editor state, not publication content.
      case "comment": return html;
      default: return html;
    }
  }, escapeHtml(text));
}

function collectHeadings(doc: TiptapNode) {
  const headings: Array<{ id: string; level: number; text: string }> = [];
  function text(node: TiptapNode): string {
    return node.text ?? (node.content ?? []).map(text).join("");
  }
  function walk(node: TiptapNode) {
    if (node.type === "heading") {
      const level = clampNumber(node.attrs?.level, 1, 1, 6);
      const label = text(node).trim();
      const id = String(node.attrs?.id ?? "").trim() || `section-${headings.length + 1}`;
      if (label) headings.push({ id, level, text: label });
    }
    for (const child of node.content ?? []) walk(child);
  }
  walk(doc);
  return headings;
}

function collectFigures(doc: TiptapNode) {
  const figures: Array<{ nodeId: string; caption: string }> = [];
  function walk(node: TiptapNode) {
    if (node.type === "commentableImage" && node.attrs?.includeInFigureIndex !== false) {
      const caption = String(node.attrs?.caption ?? "").trim();
      if (caption) figures.push({ nodeId: String(node.attrs?.nodeId ?? ""), caption });
    }
    for (const child of node.content ?? []) walk(child);
  }
  walk(doc);
  return figures;
}

function variableValue(node: TiptapNode, settings: DocumentSettingsV1) {
  const key = String(node.attrs?.key ?? "");
  return settings.variables[key] ?? "";
}

async function renderNode(
  node: TiptapNode,
  input: RenderDocumentInput,
  headings: ReturnType<typeof collectHeadings>,
  figures: ReturnType<typeof collectFigures>,
): Promise<string> {
  const children = async () => (await Promise.all(
    (node.content ?? []).map((child) => renderNode(child, input, headings, figures)),
  )).join("");
  const attrs = node.attrs ?? {};
  const keepAttrs = [
    attrs.keepWithNext ? `data-keep-with-next` : "",
    attrs.keepTogether ? `data-keep-together` : "",
  ].filter(Boolean).join(" ");

  switch (node.type) {
    case "doc":
      return children();
    case "text":
      return renderMarks(node.text ?? "", node.marks);
    case "paragraph":
      return `<p ${keepAttrs}>${await children() || "<br>"}</p>`;
    case "heading": {
      const level = clampNumber(attrs.level, 1, 1, 6);
      const rawId = String(attrs.id ?? "").trim();
      const matching = headings.find((heading) => heading.text === (node.content ?? []).map((child) => child.text ?? "").join(""));
      const id = rawId || matching?.id || "";
      return `<h${level} id="${escapeHtml(id)}" data-keep-with-next>${await children()}</h${level}>`;
    }
    case "hardBreak":
      return "<br>";
    case "horizontalRule":
      return "<hr>";
    case "blockquote":
      return `<blockquote ${keepAttrs}>${await children()}</blockquote>`;
    case "bulletList":
      return `<ul ${keepAttrs}>${await children()}</ul>`;
    case "orderedList":
      return `<ol ${keepAttrs}>${await children()}</ol>`;
    case "listItem":
      return `<li>${await children()}</li>`;
    case "taskList":
      return `<ul class="task-list" ${keepAttrs}>${await children()}</ul>`;
    case "taskItem":
      return `<li class="task-item"><span class="task-checkbox">${attrs.checked ? "✓" : ""}</span><div>${await children()}</div></li>`;
    case "codeBlock":
      return `<pre ${keepAttrs}><code>${escapeHtml((node.content ?? []).map((child) => child.text ?? "").join(""))}</code></pre>`;
    case "citation":
      return `<span class="citation">${escapeHtml(attrs.label || "(citation)")}</span>`;
    case "pdfEvidence": {
      const quote = escapeHtml(attrs.quote || attrs.label || attrs.sourceTitle || "PDF evidence");
      const source = escapeHtml(attrs.sourceTitle || "");
      const page = attrs.pageNumber ? `, p. ${escapeHtml(attrs.pageNumber)}` : "";
      return `<figure class="evidence" ${keepAttrs}><blockquote>${quote}</blockquote>${source ? `<figcaption>${source}${page}</figcaption>` : ""}</figure>`;
    }
    case "commentableImage": {
      const attachmentId = String(attrs.attachmentId ?? "");
      const src = String(attrs.src ?? "");
      const alt = String(attrs.alt ?? attrs.caption ?? "");
      const resolved = input.resolveAsset
        ? await input.resolveAsset({ attachmentId, src, alt })
        : src.startsWith("data:") ? src : null;
      if (!resolved) return `<figure class="image image-missing"><div>Image unavailable</div>${alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : ""}</figure>`;
      const width = clampNumber(attrs.widthPercent, 100, 20, 100);
      const alignment = ["left", "right"].includes(String(attrs.alignment)) ? String(attrs.alignment) : "center";
      const cropX = clampNumber(attrs.cropX, 50, 0, 100);
      const cropY = clampNumber(attrs.cropY, 50, 0, 100);
      const caption = String(attrs.caption ?? "");
      const figureNumber = figures.findIndex((figure) => figure.nodeId && figure.nodeId === String(attrs.nodeId ?? "")) + 1;
      const figureId = figureNumber ? `figure-${figureNumber}` : "";
      const numbering = figureNumber && input.settings.figures.enabled
        ? figureNumberLabel(caption, input.figureLabel ?? DEFAULT_FIGURE_LABEL, figureNumber)
        : "";
      const figureLabel = numbering ? `<span class="figure-number">${escapeHtml(numbering)}.</span> ` : "";
      return `<figure${figureId ? ` id="${figureId}"` : ""} class="image align-${alignment}" style="width:${width}%" ${keepAttrs}><img src="${resolved}" alt="${escapeHtml(alt)}" style="object-position:${cropX}% ${cropY}%">${caption ? `<figcaption>${figureLabel}${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
    }
    case "footnoteReference": {
      const label = escapeHtml(attrs.label ?? "");
      return `<sup class="footnote-reference"><a href="#footnote-${label}">${label}</a></sup>`;
    }
    case "footnoteDefinition": {
      const label = escapeHtml(attrs.label ?? "");
      return `<aside class="footnote-definition" id="footnote-${label}"><sup>${label}</sup><span>${await children()}</span></aside>`;
    }
    case "definitionList":
      return `<dl ${keepAttrs}>${await children()}</dl>`;
    case "definitionTerm":
      return `<dt>${await children()}</dt>`;
    case "definitionDescription":
      return `<dd>${await children()}</dd>`;
    case "markdownTable": {
      const rows = node.content ?? [];
      const headerRows = rows.filter((row) => row.content?.some((cell) => cell.type === "markdownTableHeader"));
      const bodyRows = rows.filter((row) => !headerRows.includes(row));
      const renderRows = async (items: TiptapNode[]) => (await Promise.all(items.map((row) => renderNode(row, input, headings, figures)))).join("");
      return `<div class="table-wrap" ${keepAttrs}><table>${headerRows.length ? `<thead>${await renderRows(headerRows)}</thead>` : ""}<tbody>${await renderRows(bodyRows)}</tbody></table></div>`;
    }
    case "markdownTableRow":
      return `<tr>${await children()}</tr>`;
    case "markdownTableHeader":
      return `<th style="${attrs.widthPercent ? `width:${clampNumber(attrs.widthPercent, 0, 1, 100)}%;` : ""}text-align:${["center", "right"].includes(String(attrs.alignment)) ? String(attrs.alignment) : "left"}">${await children()}</th>`;
    case "markdownTableCell":
      return `<td style="${attrs.widthPercent ? `width:${clampNumber(attrs.widthPercent, 0, 1, 100)}%;` : ""}text-align:${["center", "right"].includes(String(attrs.alignment)) ? String(attrs.alignment) : "left"}">${await children()}</td>`;
    case "pageBreak":
      return `<div class="page-break" aria-hidden="true"></div>`;
    case "tableOfContents": {
      const title = escapeHtml(attrs.title || "Contents");
      const maxLevel = clampNumber(attrs.maxLevel, 3, 1, 6);
      const items = headings
        .filter((heading) => heading.level <= maxLevel)
        .map((heading) => `<li class="toc-level-${heading.level}"><a href="#${escapeHtml(heading.id)}"><span>${escapeHtml(heading.text)}</span></a></li>`)
        .join("");
      return `<nav class="toc" ${keepAttrs}><h2>${title}</h2><ol>${items}</ol></nav>`;
    }
    case "documentVariable": {
      const value = variableValue(node, input.settings);
      return value
        ? `<span class="document-variable">${escapeHtml(value)}</span>`
        : `<span class="document-variable unresolved">${escapeHtml(`{${attrs.key || "variable"}}`)}</span>`;
    }
    case "layoutSection": {
      const columns = clampNumber(attrs.columns, 2, 1, 2);
      const gap = clampNumber(attrs.gapMm, 8, 4, 20);
      return `<section class="layout-columns" style="column-count:${columns};column-gap:${gap}mm" ${keepAttrs}>${await children()}</section>`;
    }
    default:
      return children();
  }
}

function printCss(settings: DocumentSettingsV1, typography: WikiTypographySettingsV1) {
  const { page } = settings;
  const pageSize = page.size === "Letter" ? "Letter" : "A4";
  const orientation = page.orientation;
  const portraitHeightMm = page.size === "Letter" ? 279.4 : 297;
  const portraitWidthMm = page.size === "Letter" ? 215.9 : 210;
  const physicalHeightMm = orientation === "portrait" ? portraitHeightMm : portraitWidthMm;
  return `
    :root {
      --ink: ${typography.textColor};
      --accent: ${typography.accentColor};
      --muted: ${typography.mutedColor};
      --body: ${wikiFontStack(typography.bodyFont)};
      --heading: ${wikiFontStack(typography.headingFont)};
      --body-size: ${typography.bodySizePt}pt;
      --line-height: ${typography.lineHeight};
      --paragraph-spacing: ${typography.paragraphSpacingEm}em;
      --list-item-spacing: ${typography.listItemSpacingEm}em;
      --list-block-spacing: ${typography.listBlockSpacingEm}em;
      --list-indent: ${typography.listIndentEm}em;
      --h1-size: ${typography.h1SizeEm}em;
      --h2-size: ${typography.h2SizeEm}em;
      --h3-size: ${typography.h3SizeEm}em;
      --heading-line-height: ${typography.headingLineHeight};
      --heading-before: ${typography.headingSpacingBeforeEm}em;
      --heading-after: ${typography.headingSpacingAfterEm}em;
    }
    @page {
      size: ${pageSize} ${orientation};
      margin: ${page.marginsMm.top}mm ${page.marginsMm.right}mm ${page.marginsMm.bottom}mm ${page.marginsMm.left}mm;
    }
    * { box-sizing: border-box; }
    html { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    body { margin: 0; color: var(--ink); background: white; font: var(--body-size)/var(--line-height) var(--body); }
    article { width: 100%; }
    .cover { min-height: calc(${physicalHeightMm}mm - ${page.marginsMm.top + page.marginsMm.bottom}mm); display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
    .cover .eyebrow { color: var(--accent); font: 700 9pt/1.2 var(--body); letter-spacing: .16em; text-transform: uppercase; }
    .cover h1 { max-width: 150mm; margin: var(--heading-before) 0 var(--heading-after); font-family: var(--heading); font-size: var(--h1-size); font-weight: 650; line-height: var(--heading-line-height); letter-spacing: -.025em; color: var(--ink); }
    .cover .subtitle { max-width: 125mm; margin: 0; color: var(--muted); font-size: 14pt; }
    .cover .meta { margin-top: 22mm; padding-top: 5mm; border-top: .7pt solid color-mix(in srgb, var(--accent) 30%, transparent); color: var(--muted); font-size: 9pt; }
    h1, h2, h3, h4, h5, h6 { margin: var(--heading-before) 0 var(--heading-after); color: var(--ink); font-family: var(--heading); line-height: var(--heading-line-height); break-after: avoid; page-break-after: avoid; }
    h1 { font-size: var(--h1-size); letter-spacing: -.02em; }
    h2 { border-top: .6pt solid color-mix(in srgb, var(--accent) 24%, transparent); font-size: var(--h2-size); }
    h3 { color: var(--accent); font-size: var(--h3-size); }
    article > :is(h1, h2, h3):first-child { margin-top: 0; }
    p { margin: 0 0 var(--paragraph-spacing); orphans: 3; widows: 3; }
    a { color: var(--accent); text-decoration-thickness: .6pt; text-underline-offset: 1.5pt; }
    blockquote { margin: 5mm 0; padding: 2mm 0 2mm 5mm; border-left: 2pt solid var(--accent); color: color-mix(in srgb, var(--ink) 78%, white); }
    ul, ol { margin-block: var(--list-block-spacing); padding-left: var(--list-indent); }
    li { margin: 0; }
    li + li { margin-top: var(--list-item-spacing); }
    li > p { margin: 0; }
    pre { overflow-wrap: anywhere; white-space: pre-wrap; margin: 5mm 0; padding: 4mm; border: .6pt solid #d8dee9; border-radius: 2mm; background: #f6f8fb; font: 8.5pt/1.5 Consolas, monospace; break-inside: avoid; }
    code { font-family: Consolas, monospace; font-size: .92em; }
    mark { background: #fff2a8; color: inherit; }
    hr { margin: 8mm 0; border: 0; border-top: .7pt solid #d8dee9; }
    .citation { white-space: nowrap; }
    .task-list { list-style: none; padding-left: 0; }
    .task-item { display: flex; align-items: flex-start; gap: 2.5mm; }
    .task-item > div { min-width: 0; flex: 1; }
    .task-checkbox { flex: 0 0 3.5mm; height: 3.5mm; margin-top: 1mm; border: .7pt solid var(--muted); line-height: 3mm; text-align: center; }
    .evidence { margin: 6mm 0; padding: 4mm 5mm; border-left: 2pt solid var(--accent); background: color-mix(in srgb, var(--accent) 6%, white); break-inside: avoid; }
    .evidence blockquote { margin: 0; padding: 0; border: 0; font-family: var(--heading); font-size: 11pt; }
    figcaption { margin-top: 2mm; color: var(--muted); font-size: 8.5pt; }
    .image { margin: 6mm auto; break-inside: avoid; }
    .image.align-left { margin-left: 0; margin-right: auto; }
    .image.align-right { margin-left: auto; margin-right: 0; }
    .image img { display: block; width: 100%; max-height: 190mm; object-fit: contain; }
    .image-missing { padding: 8mm; border: 1pt dashed #c7ced9; color: var(--muted); text-align: center; }
    .table-wrap { margin: 5mm 0; max-width: 100%; break-inside: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 8.8pt; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th, td { padding: 2.2mm 2.5mm; border: .6pt solid #cfd6e2; vertical-align: top; }
    th { background: color-mix(in srgb, var(--accent) 9%, white); color: var(--ink); font-weight: 700; text-align: left; }
    th p, td p { margin: 0; }
    dl { margin: 5mm 0; }
    dt { margin-top: 3mm; font-weight: 700; }
    dd { margin-left: 6mm; color: color-mix(in srgb, var(--ink) 82%, white); }
    .footnote-definition { display: flex; gap: 2mm; margin-top: 2mm; color: var(--muted); font-size: 8.5pt; }
    .toc { page-break-after: always; }
    .toc ol { list-style: none; padding: 0; }
    .toc li + li { margin-top: var(--list-item-spacing); }
    .toc .toc-level-2 { padding-left: 5mm; }
    .toc .toc-level-3 { padding-left: 10mm; color: var(--muted); }
    .toc a { color: inherit; text-decoration: none; }
    .layout-columns { margin: 5mm 0; }
    .layout-columns > * { break-inside: avoid-column; }
    .page-break { break-after: page; page-break-after: always; height: 0; }
    [data-keep-with-next] { break-after: avoid; page-break-after: avoid; }
    [data-keep-together] { break-inside: avoid; page-break-inside: avoid; }
    .unresolved { color: #b42318; background: #fee4e2; }
    .bibliography { ${settings.bibliography.pageBreakBefore ? "break-before: page; page-break-before: always;" : ""} }
    .bibliography ol { list-style: none; padding: 0; }
    .bibliography li { padding-left: 6mm; text-indent: -6mm; }
    .figure-index { ${settings.figures.pageBreakBefore ? "break-before: page; page-break-before: always;" : ""} }
    .figure-index ol { list-style: none; padding: 0; }
    .figure-index li { display: grid; grid-template-columns: 24mm 1fr; gap: 4mm; padding: 2mm 0; border-bottom: .5pt solid #e4e7ec; }
    .figure-index a { color: inherit; text-decoration: none; }
    .figure-index .figure-index-number, .figure-number { color: var(--muted); font-weight: 600; }
    @media screen {
      body { background: #e7ebf1; padding: 24px; }
      .print-sheet { max-width: ${page.orientation === "portrait" ? "210mm" : "297mm"}; min-height: ${page.orientation === "portrait" ? "297mm" : "210mm"}; margin: 0 auto; padding: ${page.marginsMm.top}mm ${page.marginsMm.right}mm ${page.marginsMm.bottom}mm ${page.marginsMm.left}mm; background: white; box-shadow: 0 18px 60px rgba(23,32,51,.16); }
    }
  `;
}

function marginTemplate(
  settings: DocumentSettingsV1,
  typography: WikiTypographySettingsV1,
  title: string,
  area: "header" | "footer",
) {
  const config = settings[area];
  if (!config.enabled) return "<span></span>";
  const left = escapeHtml(resolveDocumentToken(config.left, settings, { title }));
  const center = escapeHtml(resolveDocumentToken(config.center, settings, { title }));
  let right = escapeHtml(resolveDocumentToken(config.right, settings, { title }));
  if (area === "footer" && settings.footer.pageNumbers) {
    right = `${right ? `${right} · ` : ""}<span class="pageNumber"></span> / <span class="totalPages"></span>`;
  }
  return `<div style="box-sizing:border-box;width:100%;padding:0 20mm;color:${typography.mutedColor};font:8px ${wikiFontStack(typography.bodyFont)};display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px"><span>${left}</span><span style="text-align:center">${center}</span><span style="text-align:right">${right}</span></div>`;
}

export async function renderDocumentHtml(input: RenderDocumentInput): Promise<RenderedDocument> {
  const settings = normalizeDocumentSettings(input.settings);
  const typography = normalizeWikiTypography(input.typography);
  const normalizedDoc = normalizeDocumentCitations(input.doc);
  const normalizedInput = { ...input, doc: normalizedDoc, settings, typography };
  const headings = collectHeadings(normalizedDoc);
  const figures = collectFigures(normalizedDoc);
  const content = await renderNode(normalizedDoc, normalizedInput, headings, figures);
  const cover = settings.cover.enabled
    ? `<section class="cover"><p class="eyebrow">${escapeHtml(settings.cover.eyebrow)}</p><h1>${escapeHtml(input.title)}</h1>${settings.cover.subtitle ? `<p class="subtitle">${escapeHtml(settings.cover.subtitle)}</p>` : ""}<p class="meta">${escapeHtml(settings.variables.applicant)}${settings.variables.programme ? ` · ${escapeHtml(settings.variables.programme)}` : ""}${settings.variables.date ? ` · ${escapeHtml(settings.variables.date)}` : ""}</p></section>`
    : "";
  const references = settings.bibliography.enabled && input.references?.length
    ? `<section class="bibliography"><h2>${escapeHtml(settings.bibliography.heading)}</h2><ol>${input.references.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol></section>`
    : "";
  const figureLabel = input.figureLabel ?? DEFAULT_FIGURE_LABEL;
  const figureIndex = settings.figures.enabled && figures.length
    ? `<section class="figure-index"><h2>${escapeHtml(settings.figures.heading)}</h2><ol>${figures.map((figure, index) => `<li><a class="figure-index-number" href="#figure-${index + 1}">${escapeHtml(figureNumberLabel(figure.caption, figureLabel, index + 1))}</a><a href="#figure-${index + 1}">${escapeHtml(figure.caption)}</a></li>`).join("")}</ol></section>`
    : "";
  const article = `<article>${content}${figureIndex}${references}</article>`;
  const bodyHtml = `${cover}${article}`;
  const shell = (inner: string, extraCss = "") => `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>${escapeHtml(input.title)}</title><style>${printCss(settings, typography)}${extraCss}</style></head><body><main class="print-sheet">${inner}</main></body></html>`;
  const html = shell(bodyHtml);
  return {
    html,
    bodyHtml,
    bodyDocumentHtml: shell(article),
    coverDocumentHtml: cover ? shell(cover, ".cover{break-after:auto!important;page-break-after:auto!important}") : null,
    headerTemplate: marginTemplate(settings, typography, input.title, "header"),
    footerTemplate: marginTemplate(settings, typography, input.title, "footer"),
    issues: collectDocumentPreflightIssues(input.doc, settings),
  };
}

function markdownText(node: TiptapNode): string {
  if (node.text !== undefined) {
    return (node.marks ?? []).reduce((text, mark) => {
      if (mark.type === "bold") return `**${text}**`;
      if (mark.type === "italic") return `*${text}*`;
      if (mark.type === "strike") return `~~${text}~~`;
      if (mark.type === "code") return `\`${text}\``;
      if (mark.type === "link") return `[${text}](${String(mark.attrs?.href ?? "")})`;
      return text;
    }, node.text);
  }
  return (node.content ?? []).map(markdownText).join("");
}

/**
 * `baseUrl` turns the app-relative image paths into absolute ones. A downloaded
 * .md file is read outside the app, where `/api/wiki/svg-assets/…` resolves nowhere.
 */
export function renderDocumentMarkdown(doc: TiptapNode, settings: DocumentSettingsV1, baseUrl = ""): string {
  const absolute = (src: string) => baseUrl && src.startsWith("/") ? `${baseUrl.replace(/\/$/, "")}${src}` : src;
  function render(node: TiptapNode, depth = 0, listMarker = "-"): string {
    const children = node.content ?? [];
    const content = children.map((child) => render(child, depth + 1)).join("");
    switch (node.type) {
      case "doc": return content;
      case "text": return markdownText(node);
      case "paragraph": return `${content}\n\n`;
      case "heading": return `${"#".repeat(clampNumber(node.attrs?.level, 1, 1, 6))} ${content}\n\n`;
      case "blockquote": return content.trim().split("\n").map((line) => `> ${line}`).join("\n") + "\n\n";
      case "bulletList":
        return children.map((child) => render(child, depth + 1, "-")).join("") + "\n";
      case "orderedList": {
        const start = Math.max(1, Number(node.attrs?.start) || 1);
        return children.map((child, index) => render(child, depth + 1, `${start + index}.`)).join("") + "\n";
      }
      case "taskList":
        return children.map((child) => render(child, depth + 1, `- [${child.attrs?.checked ? "x" : " "}]`)).join("") + "\n";
      case "listItem":
      case "taskItem":
        return `${"  ".repeat(Math.max(0, depth - 2))}${listMarker} ${content.trim()}\n`;
      case "codeBlock": return `\`\`\`\n${content}\n\`\`\`\n\n`;
      case "horizontalRule": return "---\n\n";
      case "hardBreak": return "  \n";
      case "citation": return String(node.attrs?.label ?? "");
      case "documentVariable": return settings.variables[String(node.attrs?.key ?? "")] || `{${String(node.attrs?.key ?? "variable")}}`;
      case "pageBreak": return "\n<div style=\"page-break-after: always\"></div>\n\n";
      case "commentableImage": {
        const caption = String(node.attrs?.caption ?? "").trim();
        return `![${String(node.attrs?.alt ?? "")}](${absolute(String(node.attrs?.src ?? ""))})\n${caption ? `\n*${caption}*\n` : ""}\n`;
      }
      case "footnoteReference": return `[^${String(node.attrs?.label ?? "")}]`;
      case "footnoteDefinition": return `[^${String(node.attrs?.label ?? "")}]: ${content.trim()}\n\n`;
      default: return content;
    }
  }
  return render(normalizeDocumentCitations(doc)).trim() + "\n";
}
