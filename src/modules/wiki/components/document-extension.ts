import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

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
  TableOfContents,
  DocumentVariable,
  LayoutSection,
  DocumentBlockAttributes,
  DocumentPagination,
];

