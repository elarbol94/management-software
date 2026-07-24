import {
  collectDocumentPreflightIssues,
  normalizeDocumentSettings,
  resolveDocumentToken,
  type DocumentPreflightIssue,
  type DocumentSettingsV1,
} from "./document-settings";
import type { TiptapNode } from "./tiptap";

export type DocumentAssetResolver = (input: {
  attachmentId: string;
  src: string;
  alt: string;
}) => Promise<string | null>;

export type RenderDocumentInput = {
  title: string;
  doc: TiptapNode;
  settings: DocumentSettingsV1;
  references?: string[];
  resolveAsset?: DocumentAssetResolver;
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

function variableValue(node: TiptapNode, settings: DocumentSettingsV1) {
  const key = String(node.attrs?.key ?? "");
  return settings.variables[key] ?? "";
}

async function renderNode(
  node: TiptapNode,
  input: RenderDocumentInput,
  headings: ReturnType<typeof collectHeadings>,
): Promise<string> {
  const children = async () => (await Promise.all(
    (node.content ?? []).map((child) => renderNode(child, input, headings)),
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
      return `<figure class="image align-${alignment}" style="width:${width}%" ${keepAttrs}><img src="${resolved}" alt="${escapeHtml(alt)}" style="object-position:${cropX}% ${cropY}%">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
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
      const renderRows = async (items: TiptapNode[]) => (await Promise.all(items.map((row) => renderNode(row, input, headings)))).join("");
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

function fontFamily(value: DocumentSettingsV1["theme"]["bodyFont"]) {
  if (value === "serif") return `Georgia, "Times New Roman", serif`;
  if (value === "humanist") return `"Segoe UI", "Aptos", Arial, sans-serif`;
  return `Arial, Helvetica, sans-serif`;
}

function printCss(settings: DocumentSettingsV1) {
  const { page, theme } = settings;
  const pageSize = page.size === "Letter" ? "Letter" : "A4";
  const orientation = page.orientation;
  const portraitHeightMm = page.size === "Letter" ? 279.4 : 297;
  const portraitWidthMm = page.size === "Letter" ? 215.9 : 210;
  const physicalHeightMm = orientation === "portrait" ? portraitHeightMm : portraitWidthMm;
  return `
    :root {
      --ink: ${theme.textColor};
      --accent: ${theme.accentColor};
      --muted: ${theme.mutedColor};
      --body: ${fontFamily(theme.bodyFont)};
      --heading: ${fontFamily(theme.headingFont)};
    }
    @page {
      size: ${pageSize} ${orientation};
      margin: ${page.marginsMm.top}mm ${page.marginsMm.right}mm ${page.marginsMm.bottom}mm ${page.marginsMm.left}mm;
    }
    * { box-sizing: border-box; }
    html { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    body { margin: 0; color: var(--ink); background: white; font: ${theme.bodySizePt}pt/${theme.lineHeight} var(--body); }
    article { width: 100%; }
    .cover { min-height: calc(${physicalHeightMm}mm - ${page.marginsMm.top + page.marginsMm.bottom}mm); display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
    .cover .eyebrow { color: var(--accent); font: 700 9pt/1.2 var(--body); letter-spacing: .16em; text-transform: uppercase; }
    .cover h1 { max-width: 150mm; margin: 8mm 0 5mm; font: 650 34pt/1.05 var(--heading); letter-spacing: -.025em; color: var(--ink); }
    .cover .subtitle { max-width: 125mm; margin: 0; color: var(--muted); font-size: 14pt; }
    .cover .meta { margin-top: 22mm; padding-top: 5mm; border-top: .7pt solid color-mix(in srgb, var(--accent) 30%, transparent); color: var(--muted); font-size: 9pt; }
    h1, h2, h3, h4, h5, h6 { color: var(--ink); font-family: var(--heading); break-after: avoid; page-break-after: avoid; }
    h1 { margin: 0 0 8mm; font-size: 24pt; line-height: 1.1; letter-spacing: -.02em; }
    h2 { margin: 9mm 0 3.5mm; padding-top: 2mm; border-top: .6pt solid color-mix(in srgb, var(--accent) 24%, transparent); font-size: 16pt; line-height: 1.18; }
    h3 { margin: 6mm 0 2.5mm; color: var(--accent); font-size: 12pt; line-height: 1.25; }
    p { margin: 0 0 3.5mm; orphans: 3; widows: 3; }
    a { color: var(--accent); text-decoration-thickness: .6pt; text-underline-offset: 1.5pt; }
    blockquote { margin: 5mm 0; padding: 2mm 0 2mm 5mm; border-left: 2pt solid var(--accent); color: color-mix(in srgb, var(--ink) 78%, white); }
    ul, ol { margin: 0 0 4mm; padding-left: 7mm; }
    li { margin: 0 0 1.3mm; }
    pre { overflow-wrap: anywhere; white-space: pre-wrap; margin: 5mm 0; padding: 4mm; border: .6pt solid #d8dee9; border-radius: 2mm; background: #f6f8fb; font: 8.5pt/1.5 Consolas, monospace; break-inside: avoid; }
    code { font-family: Consolas, monospace; font-size: .92em; }
    mark { background: #fff2a8; color: inherit; }
    hr { margin: 8mm 0; border: 0; border-top: .7pt solid #d8dee9; }
    .citation { white-space: nowrap; }
    .task-list { list-style: none; padding-left: 0; }
    .task-item { display: flex; gap: 2.5mm; }
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
    .toc li { margin: 0 0 2mm; }
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
    .bibliography li { padding-left: 6mm; text-indent: -6mm; margin-bottom: 3mm; }
    @media screen {
      body { background: #e7ebf1; padding: 24px; }
      .print-sheet { max-width: ${page.orientation === "portrait" ? "210mm" : "297mm"}; min-height: ${page.orientation === "portrait" ? "297mm" : "210mm"}; margin: 0 auto; padding: ${page.marginsMm.top}mm ${page.marginsMm.right}mm ${page.marginsMm.bottom}mm ${page.marginsMm.left}mm; background: white; box-shadow: 0 18px 60px rgba(23,32,51,.16); }
    }
  `;
}

function marginTemplate(
  settings: DocumentSettingsV1,
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
  return `<div style="box-sizing:border-box;width:100%;padding:0 20mm;color:${settings.theme.mutedColor};font:8px Arial,sans-serif;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px"><span>${left}</span><span style="text-align:center">${center}</span><span style="text-align:right">${right}</span></div>`;
}

export async function renderDocumentHtml(input: RenderDocumentInput): Promise<RenderedDocument> {
  const settings = normalizeDocumentSettings(input.settings);
  const normalizedInput = { ...input, settings };
  const headings = collectHeadings(input.doc);
  const content = await renderNode(input.doc, normalizedInput, headings);
  const cover = settings.cover.enabled
    ? `<section class="cover"><p class="eyebrow">${escapeHtml(settings.cover.eyebrow)}</p><h1>${escapeHtml(input.title)}</h1>${settings.cover.subtitle ? `<p class="subtitle">${escapeHtml(settings.cover.subtitle)}</p>` : ""}<p class="meta">${escapeHtml(settings.variables.applicant)}${settings.variables.programme ? ` · ${escapeHtml(settings.variables.programme)}` : ""}${settings.variables.date ? ` · ${escapeHtml(settings.variables.date)}` : ""}</p></section>`
    : "";
  const references = settings.bibliography.enabled && input.references?.length
    ? `<section class="bibliography"><h2>${escapeHtml(settings.bibliography.heading)}</h2><ol>${input.references.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ol></section>`
    : "";
  const article = `<article>${content}${references}</article>`;
  const bodyHtml = `${cover}${article}`;
  const shell = (inner: string, extraCss = "") => `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>${escapeHtml(input.title)}</title><style>${printCss(settings)}${extraCss}</style></head><body><main class="print-sheet">${inner}</main></body></html>`;
  const html = shell(bodyHtml);
  return {
    html,
    bodyHtml,
    bodyDocumentHtml: shell(article),
    coverDocumentHtml: cover ? shell(cover, ".cover{break-after:auto!important;page-break-after:auto!important}") : null,
    headerTemplate: marginTemplate(settings, input.title, "header"),
    footerTemplate: marginTemplate(settings, input.title, "footer"),
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

export function renderDocumentMarkdown(doc: TiptapNode, settings: DocumentSettingsV1): string {
  function render(node: TiptapNode, depth = 0): string {
    const content = (node.content ?? []).map((child) => render(child, depth + 1)).join("");
    switch (node.type) {
      case "doc": return content;
      case "text": return markdownText(node);
      case "paragraph": return `${content}\n\n`;
      case "heading": return `${"#".repeat(clampNumber(node.attrs?.level, 1, 1, 6))} ${content}\n\n`;
      case "blockquote": return content.trim().split("\n").map((line) => `> ${line}`).join("\n") + "\n\n";
      case "bulletList": return content + "\n";
      case "orderedList": return content + "\n";
      case "listItem": return `${"  ".repeat(Math.max(0, depth - 2))}- ${content.trim()}\n`;
      case "codeBlock": return `\`\`\`\n${content}\n\`\`\`\n\n`;
      case "horizontalRule": return "---\n\n";
      case "hardBreak": return "  \n";
      case "citation": return String(node.attrs?.label ?? "");
      case "documentVariable": return settings.variables[String(node.attrs?.key ?? "")] || `{${String(node.attrs?.key ?? "variable")}}`;
      case "pageBreak": return "\n<div style=\"page-break-after: always\"></div>\n\n";
      case "commentableImage": return `![${String(node.attrs?.alt ?? "")}](${String(node.attrs?.src ?? "")})\n\n`;
      case "footnoteReference": return `[^${String(node.attrs?.label ?? "")}]`;
      case "footnoteDefinition": return `[^${String(node.attrs?.label ?? "")}]: ${content.trim()}\n\n`;
      default: return content;
    }
  }
  return render(doc).trim() + "\n";
}
