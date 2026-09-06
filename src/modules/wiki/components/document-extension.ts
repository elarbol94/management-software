import { Extension, Mark, Node, mergeAttributes, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { DocumentPaginationBreak } from "../lib/document-pagination";
import { figureNumberLabel, resolveCrossReferenceLabels } from "../lib/figure-caption";
import { isFigure, numberedFigure, stripFigureNumber } from "../lib/figure";
import { TableOfContentsView } from "./table-of-contents-view";

export type { DocumentPaginationBreak, DocumentPaginationBreakKind } from "../lib/document-pagination";

const documentPaginationKey = new PluginKey<DocumentPaginationBreak[]>("documentPagination");

export function setDocumentPaginationBreaks(editor: Editor, breaks: DocumentPaginationBreak[]) {
  editor.view.dispatch(editor.state.tr.setMeta(documentPaginationKey, breaks));
}

export function getDocumentPaginationBreaks(editor: Editor) {
  return documentPaginationKey.getState(editor.state) ?? [];
}

/**
 * Which page (1-indexed) a document position falls on, given the current break
 * list. A break's `page` is the page its own content starts on, so the position
 * is on the page of the latest break at or before it (or page 1 before any break).
 */
export function pageForPosition(breaks: DocumentPaginationBreak[], position: number): number {
  let page = 1;
  let bestPosition = -1;
  for (const item of breaks) {
    if (item.position <= position && item.position > bestPosition) {
      bestPosition = item.position;
      page = item.page;
    }
  }
  return page;
}

/**
 * Section-number label per heading ("1. ", "1.2 ", "1.2.3 "), mirroring the
 * CSS counters used for numbered headings in export (document-renderer.ts) and
 * the live editor canvas (.wiki-document-canvas[data-numbered-headings] in
 * globals.css). Only levels 1-3 are numbered there, so deeper headings get "".
 */
export function numberHeadings(headings: Array<{ level: number }>): string[] {
  const counters = [0, 0, 0];
  return headings.map((heading) => {
    const level = heading.level;
    if (level < 1 || level > 3) return "";
    counters[level - 1] += 1;
    for (let index = level; index < 3; index += 1) counters[index] = 0;
    const parts = counters.slice(0, level);
    return level === 1 ? `${parts[0]}. ` : `${parts.join(".")} `;
  });
}

export function samePaginationBreaks(left: DocumentPaginationBreak[], right: DocumentPaginationBreak[]) {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return item.position === other.position
      && item.page === other.page
      && item.kind === other.kind
      && Math.abs(item.height - other.height) < 0.5;
  });
}

const DocumentPagination = Extension.create({
  name: "documentPagination",
  addProseMirrorPlugins() {
    return [new Plugin<DocumentPaginationBreak[]>({
      key: documentPaginationKey,
      state: {
        init: () => [],
        apply(transaction, breaks) {
          const replacement = transaction.getMeta(documentPaginationKey) as DocumentPaginationBreak[] | undefined;
          if (replacement) return replacement;
          if (!transaction.docChanged) return breaks;
          // Keep the spacers while text changes and only move them along with the
          // document. Dropping them here collapsed the whole page stack until the
          // next measurement, which made the document jump under the caret.
          const mapped: DocumentPaginationBreak[] = [];
          for (const item of breaks) {
            const result = transaction.mapping.mapResult(item.position, -1);
            if (result.deleted || mapped.some((existing) => existing.position === result.pos)) continue;
            mapped.push({ ...item, position: result.pos });
          }
          return mapped;
        },
      },
      props: {
        decorations(state) {
          const breaks = documentPaginationKey.getState(state) ?? [];
          return DecorationSet.create(state.doc, breaks.map((item) => Decoration.widget(item.position, () => {
            const height = Math.max(0, item.height);
            // Breaks inside a paragraph, code block or table need a spacer the
            // surrounding formatting context accepts, so the element follows the kind.
            const tag = item.kind === "listItem" ? "li" : item.kind === "inline" ? "span" : item.kind === "tableRow" ? "tr" : "div";
            const spacer = document.createElement(tag);
            spacer.className = "wiki-document-auto-page-break";
            spacer.contentEditable = "false";
            spacer.dataset.page = String(item.page);
            spacer.setAttribute("aria-hidden", "true");
            if (item.kind === "tableRow") {
              const cell = document.createElement("td");
              cell.colSpan = 100;
              cell.style.height = `${height}px`;
              cell.style.padding = "0";
              cell.style.border = "0";
              spacer.append(cell);
            } else {
              if (item.kind === "inline") spacer.style.display = "block";
              spacer.style.height = `${height}px`;
            }
            return spacer;
          }, { key: `page-${item.page}-${item.position}-${Math.round(item.height)}-${item.kind ?? "block"}`, side: -1 })));
        },
      },
    })];
  },
});

const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div[data-document-page-break]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, {
      "data-document-page-break": "",
      class: "wiki-document-page-break",
      role: "separator",
    }),
    ["span", { contenteditable: "false" }, "Page break"],
  ],
});

const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({
    title: { default: "Contents" },
    maxLevel: { default: 3 },
  }),
  parseHTML: () => [{ tag: "nav[data-document-toc]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "nav",
    mergeAttributes(HTMLAttributes, {
      "data-document-toc": "",
      class: "wiki-document-toc",
      contenteditable: "false",
    }),
    ["strong", {}, HTMLAttributes.title || "Contents"],
    ["p", {}, "Generated from headings during export"],
  ],
  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsView);
  },
});

const DocumentVariable = Node.create({
  name: "documentVariable",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    key: { default: "" },
    label: { default: "" },
  }),
  parseHTML: () => [{ tag: "span[data-document-variable]" }],
  renderHTML: ({ HTMLAttributes }) => {
    const key = String(HTMLAttributes.key ?? "");
    const label = String(HTMLAttributes.label ?? key);
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-document-variable": key,
        class: "wiki-document-variable",
        contenteditable: "false",
      }),
      label ? `{${label}}` : "{variable}",
    ];
  },
});

const LayoutSection = Node.create({
  name: "layoutSection",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes: () => ({
    columns: { default: 2 },
    gapMm: { default: 8 },
    keepTogether: { default: false },
  }),
  parseHTML: () => [{ tag: "section[data-document-columns]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "section",
    mergeAttributes(HTMLAttributes, {
      "data-document-columns": String(HTMLAttributes.columns ?? 2),
      class: "wiki-document-columns",
      style: `--document-columns:${Number(HTMLAttributes.columns) === 1 ? 1 : 2};--document-column-gap:${Math.max(4, Math.min(20, Number(HTMLAttributes.gapMm) || 8))}mm`,
    }),
    0,
  ],
});

const ProposalCallout = Node.create({
  name: "proposalCallout",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes: () => ({ kind: { default: "info" }, title: { default: "" } }),
  parseHTML: () => [{ tag: "aside[data-proposal-callout]" }],
  renderHTML: ({ HTMLAttributes }) => ["aside", mergeAttributes(HTMLAttributes, {
    "data-proposal-callout": HTMLAttributes.kind,
    class: "wiki-proposal-callout wiki-proposal-callout-" + HTMLAttributes.kind,
  }), HTMLAttributes.title ? ["strong", { contenteditable: "false" }, HTMLAttributes.title] : ["span", { class: "sr-only" }, "Callout"], ["div", 0]],
});

const ProposalSuggestion = Mark.create({
  name: "proposalSuggestion", inclusive: false,
  addAttributes: () => ({ kind: { default: "insert" }, author: { default: "" }, createdAt: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-proposal-suggestion]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-proposal-suggestion": HTMLAttributes.kind, class: `wiki-proposal-suggestion wiki-proposal-suggestion-${HTMLAttributes.kind}` }), 0],
});

export type DocumentNumberingConfig = {
  figureLabel: string;
  tableLabel: string;
  /** Caption numbering is independent of the presence of a figure list. */
  numberFigures: boolean;
  numberTables: boolean;
  missingReferenceLabel?: string;
  pageNumberStart?: number;
};
const DEFAULT_NUMBERING_CONFIG: DocumentNumberingConfig = { figureLabel: "Figure", tableLabel: "Table", numberFigures: false, numberTables: false };

export type DocumentNumberingState = {
  config: DocumentNumberingConfig;
  /** targetId (heading id / annexId / figure nodeId / table tableId) -> live label. */
  labels: Map<string, string>;
  /** targetId -> current position in the live document, for scroll-to-target. */
  positions: Map<string, number>;
  headings: Array<{ id: string; text: string }>;
  annexes: Array<{ id: string; title: string }>;
  figures: Array<{ id: string; caption: string }>;
  tables: Array<{ id: string; caption: string }>;
  decorations: DecorationSet;
};

const documentNumberingKey = new PluginKey<DocumentNumberingState>("documentNumbering");

/** Escapes a generated numbering string for use inside a single-quoted CSS `content:` value. */
function cssQuotedString(value: string) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function computeDocumentNumberingState(doc: ProseMirrorNode, config: DocumentNumberingConfig): DocumentNumberingState {
  const headings: Array<{ id: string; text: string }> = [];
  const annexes: Array<{ id: string; title: string }> = [];
  const figures: Array<{ id: string; caption: string }> = [];
  const tables: Array<{ id: string; caption: string }> = [];
  const positions = new Map<string, number>();

  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const id = String(node.attrs.id ?? "").trim();
      if (id) { headings.push({ id, text: node.textContent.trim() }); positions.set(id, pos); }
    } else if (node.type.name === "annexMarker") {
      const id = String(node.attrs.annexId ?? "").trim();
      if (id) { annexes.push({ id, title: String(node.attrs.title ?? "Annex") }); positions.set(id, pos); }
    } else if (isFigure(node.type.name)) {
      const caption = stripFigureNumber(String(node.attrs.caption ?? ""));
      const id = String(node.attrs.nodeId ?? "");
      if (id && numberedFigure(node.attrs)) { figures.push({ id, caption }); positions.set(id, pos); }
    } else if (node.type.name === "markdownTable") {
      const caption = String(node.attrs.caption ?? "").trim();
      const id = String(node.attrs.tableId ?? "");
      if (id && caption && node.attrs.includeInTableIndex !== false) { tables.push({ id, caption }); positions.set(id, pos); }
    }
    return true;
  });

  const labels = resolveCrossReferenceLabels({ headings, annexes, figures, tables, figureLabel: config.figureLabel, tableLabel: config.tableLabel });

  const decorationList: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (config.numberFigures && isFigure(node.type.name)) {
      const index = figures.findIndex((figure) => figure.id === String(node.attrs.nodeId ?? ""));
      if (index >= 0) {
        const prefix = figureNumberLabel(figures[index].caption, config.figureLabel, index + 1);
        if (prefix) decorationList.push(Decoration.node(pos, pos + node.nodeSize, { style: `--wiki-figure-number:${cssQuotedString(`${prefix}. `)}` }));
      }
    } else if (config.numberTables && node.type.name === "markdownTable") {
      const index = tables.findIndex((table) => table.id === String(node.attrs.tableId ?? ""));
      if (index >= 0) decorationList.push(Decoration.node(pos, pos + node.nodeSize, { style: `--wiki-table-number:${cssQuotedString(`${config.tableLabel} ${index + 1}. `)}` }));
    } else if (node.type.name === "crossReference") {
      const targetId = String(node.attrs.targetId ?? "");
      // Diffed against the previous decoration set, so the CrossReference node view
      // only re-renders when its resolved label actually changed.
      decorationList.push(Decoration.node(pos, pos + node.nodeSize, { "data-wiki-cross-reference-label": (targetId && labels.get(targetId)) || config.missingReferenceLabel || "Reference target missing" }));
    }
    return true;
  });

  return {
    config,
    labels,
    positions,
    headings,
    annexes,
    figures,
    tables,
    decorations: DecorationSet.create(doc, decorationList),
  };
}

const DocumentNumbering = Extension.create({
  name: "documentNumbering",
  addProseMirrorPlugins() {
    return [new Plugin<DocumentNumberingState>({
      key: documentNumberingKey,
      state: {
        init: (_, state) => computeDocumentNumberingState(state.doc, DEFAULT_NUMBERING_CONFIG),
        apply(transaction, previous) {
          const meta = transaction.getMeta(documentNumberingKey) as Partial<DocumentNumberingConfig> | undefined;
          if (!transaction.docChanged && !meta) return previous;
          const config = meta ? { ...previous.config, ...meta } : previous.config;
          return computeDocumentNumberingState(transaction.doc, config);
        },
      },
      props: {
        decorations(state) {
          return documentNumberingKey.getState(state)?.decorations;
        },
      },
    })];
  },
});

/** Pushes the document's figure/table numbering language into the live editor. */
export function setDocumentNumberingConfig(editor: Editor, config: DocumentNumberingConfig) {
  editor.view.dispatch(editor.state.tr.setMeta(documentNumberingKey, config));
}

export function getDocumentNumberingState(editor: Editor): DocumentNumberingState | undefined {
  return documentNumberingKey.getState(editor.state);
}

function scrollTargetIntoView(view: { nodeDOM: (pos: number) => globalThis.Node | null }, pos: number) {
  const dom = view.nodeDOM(pos);
  const element = dom instanceof HTMLElement ? dom : dom?.parentElement;
  element?.scrollIntoView({ behavior: "smooth", block: "center" });
}

const CrossReference = Node.create({
  name: "crossReference", group: "inline", inline: true, atom: true, selectable: true,
  addAttributes: () => ({ targetId: { default: "" }, label: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-document-cross-reference]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-document-cross-reference": HTMLAttributes.targetId, class: "wiki-document-cross-reference", contenteditable: "false" }), HTMLAttributes.label || "Reference"],
  addNodeView() {
    return ({ node, view, getPos }) => {
      let current = node;
      const dom = document.createElement("span");
      dom.className = "wiki-document-cross-reference";
      dom.setAttribute("contenteditable", "false");

      const render = () => {
        const targetId = String(current.attrs.targetId ?? "");
        dom.dataset.documentCrossReference = targetId;
        const numbering = documentNumberingKey.getState(view.state);
        const resolved = targetId && numbering?.labels.get(targetId);
        const label = resolved || numbering?.config.missingReferenceLabel || "Reference target missing";
        dom.dataset.missing = resolved ? "false" : "true";
        dom.setAttribute("role", "button");
        dom.tabIndex = 0;
        dom.textContent = label;
      };
      render();

      dom.addEventListener("click", (event) => {
        event.preventDefault();
        const targetId = String(current.attrs.targetId ?? "");
        const pos = targetId ? documentNumberingKey.getState(view.state)?.positions.get(targetId) : undefined;
        if (pos !== undefined) scrollTargetIntoView(view, pos);
        else dom.dispatchEvent(new CustomEvent("wiki-reference-repair", { bubbles: true, detail: { position: getPos() } }));
      });
      dom.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); dom.click(); } });

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "crossReference") return false;
          current = updatedNode;
          render();
          return true;
        },
        selectNode: () => dom.classList.add("ProseMirror-selectednode"),
        deselectNode: () => dom.classList.remove("ProseMirror-selectednode"),
        ignoreMutation: () => true,
      };
    };
  },
});

const AnnexMarker = Node.create({
  name: "annexMarker", group: "block", atom: true, selectable: true,
  addAttributes: () => ({ annexId: { default: "" }, title: { default: "Annex" } }),
  parseHTML: () => [{ tag: "section[data-document-annex]" }],
  renderHTML: ({ HTMLAttributes }) => ["section", mergeAttributes(HTMLAttributes, { "data-document-annex": HTMLAttributes.annexId, class: "wiki-document-annex", contenteditable: "false" }), ["strong", {}, HTMLAttributes.title || "Annex"]],
});

const SignatureBlock = Node.create({
  name: "signatureBlock", group: "block", atom: true, selectable: true,
  addAttributes: () => ({ name: { default: "" }, role: { default: "" }, location: { default: "" }, date: { default: "" } }),
  parseHTML: () => [{ tag: "section[data-document-signature]" }],
  renderHTML: ({ HTMLAttributes }) => ["section", mergeAttributes(HTMLAttributes, { "data-document-signature": "", class: "wiki-document-signature", contenteditable: "false" }), ["span", {}, `${HTMLAttributes.location || "Place"}, ${HTMLAttributes.date || "date"}`], ["strong", {}, HTMLAttributes.name || "Signature"], ["small", {}, HTMLAttributes.role || "Role"]],
});

const DocumentBlockAttributes = Extension.create({
  name: "documentBlockAttributes",
  addGlobalAttributes() {
    return [{
      types: [
        "paragraph",
        "heading",
        "blockquote",
        "bulletList",
        "orderedList",
        "taskList",
        "codeBlock",
        "markdownTable",
        "commentableImage",
        "pdfEvidence",
        "layoutSection",
      ],
      attributes: {
        keepWithNext: {
          default: false,
          parseHTML: (element) => element.hasAttribute("data-keep-with-next"),
          renderHTML: (attributes) => attributes.keepWithNext ? { "data-keep-with-next": "" } : {},
        },
        keepTogether: {
          default: false,
          parseHTML: (element) => element.hasAttribute("data-keep-together"),
          renderHTML: (attributes) => attributes.keepTogether ? { "data-keep-together": "" } : {},
        },
      },
    }];
  },
});

export const DocumentExtensions = [
  PageBreak,
  ProposalCallout,
  ProposalSuggestion,
  TableOfContents,
  DocumentVariable,
  LayoutSection,
  CrossReference,
  AnnexMarker,
  SignatureBlock,
  DocumentBlockAttributes,
  DocumentPagination,
  DocumentNumbering,
];

