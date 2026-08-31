import { Extension, Mark, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { TableOfContentsView } from "./table-of-contents-view";

export type DocumentPaginationBreak = {
  position: number;
  height: number;
  page: number;
  kind?: "block" | "listItem";
};

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
            const spacer = document.createElement(item.kind === "listItem" ? "li" : "div");
            spacer.className = "wiki-document-auto-page-break";
            spacer.contentEditable = "false";
            spacer.dataset.page = String(item.page);
            spacer.style.height = `${Math.max(0, item.height)}px`;
            spacer.setAttribute("aria-hidden", "true");
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

const CrossReference = Node.create({
  name: "crossReference", group: "inline", inline: true, atom: true, selectable: true,
  addAttributes: () => ({ targetId: { default: "" }, label: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-document-cross-reference]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-document-cross-reference": HTMLAttributes.targetId, class: "wiki-document-cross-reference", contenteditable: "false" }), HTMLAttributes.label || "Reference"],
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
];

