import { Extension, Node, mergeAttributes } from "@tiptap/core";

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
];

