import { Extension, Mark, Node, mergeAttributes, type Editor } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Code from "@tiptap/extension-code";
import Italic from "@tiptap/extension-italic";
import { isAllowedUri } from "@tiptap/extension-link";
import Strike from "@tiptap/extension-strike";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import {
  applyMarkdownShortcut,
  findMarkdownShortcutAtSelection,
  type MarkdownShortcutBoundary,
} from "../lib/markdown-shortcuts";

const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",
  parseHTML: () => [{ tag: "sub" }],
  renderHTML: ({ HTMLAttributes }) => ["sub", mergeAttributes(HTMLAttributes), 0],
});

const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",
  parseHTML: () => [{ tag: "sup:not([data-footnote-reference])" }],
  renderHTML: ({ HTMLAttributes }) => ["sup", mergeAttributes(HTMLAttributes), 0],
});

const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ label: { default: "" } }),
  parseHTML: () => [{ tag: "sup[data-footnote-reference]" }],
  renderHTML: ({ HTMLAttributes }) => {
    const label = String(HTMLAttributes.label ?? "");
    return ["sup", mergeAttributes(HTMLAttributes, {
      "data-footnote-reference": label,
      class: "wiki-footnote-reference",
    }), ["a", { href: `#footnote-${label}`, contenteditable: "false" }, label]];
  },
});

const FootnoteDefinition = Node.create({
  name: "footnoteDefinition",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes: () => ({ label: { default: "" } }),
  parseHTML: () => [{ tag: "aside[data-footnote-definition]" }],
  renderHTML: ({ HTMLAttributes }) => {
    const label = String(HTMLAttributes.label ?? "");
    return ["aside", mergeAttributes(HTMLAttributes, {
      id: `footnote-${label}`,
      "data-footnote-definition": label,
      class: "wiki-footnote-definition",
    }), ["sup", { contenteditable: "false" }, label], ["span", 0]];
  },
});

const DefinitionList = Node.create({
  name: "definitionList",
  group: "block",
  content: "definitionTerm definitionDescription+",
  parseHTML: () => [{ tag: "dl[data-markdown-definition-list]" }],
  renderHTML: ({ HTMLAttributes }) => ["dl", mergeAttributes(HTMLAttributes, {
    "data-markdown-definition-list": "",
    class: "wiki-definition-list",
  }), 0],
});

const DefinitionTerm = Node.create({
  name: "definitionTerm",
  content: "inline*",
  parseHTML: () => [{ tag: "dt" }],
  renderHTML: ({ HTMLAttributes }) => ["dt", mergeAttributes(HTMLAttributes), 0],
});

const DefinitionDescription = Node.create({
  name: "definitionDescription",
  content: "inline*",
  parseHTML: () => [{ tag: "dd" }],
  renderHTML: ({ HTMLAttributes }) => ["dd", mergeAttributes(HTMLAttributes), 0],
});

const MarkdownTable = Node.create({
  name: "markdownTable",
  group: "block",
  content: "markdownTableRow+",
  isolating: true,
  addAttributes: () => ({
    tableId: { default: null },
    caption: { default: "" },
    includeInTableIndex: { default: true },
  }),
  parseHTML: () => [{ tag: "table[data-markdown-table]" }],
  renderHTML: ({ HTMLAttributes }) => ["table", mergeAttributes(HTMLAttributes, {
    "data-markdown-table": "",
    "data-table-id": HTMLAttributes.tableId || undefined,
    "data-table-caption": HTMLAttributes.caption || undefined,
    class: "wiki-markdown-table",
  }), ...(HTMLAttributes.caption ? [["caption", { contenteditable: "false" }, HTMLAttributes.caption]] : []), ["tbody", 0]],
});

const MarkdownTableRow = Node.create({
  name: "markdownTableRow",
  content: "(markdownTableHeader|markdownTableCell)+",
  parseHTML: () => [{ tag: "tr" }],
  renderHTML: ({ HTMLAttributes }) => ["tr", mergeAttributes(HTMLAttributes), 0],
});

const MarkdownTableHeader = Node.create({
  name: "markdownTableHeader",
  content: "paragraph+",
  addAttributes: () => ({
    widthPercent: { default: null },
    alignment: { default: "left" },
  }),
  parseHTML: () => [{ tag: "th" }],
  renderHTML: ({ HTMLAttributes }) => ["th", mergeAttributes(HTMLAttributes, {
    style: `${HTMLAttributes.widthPercent ? `width:${HTMLAttributes.widthPercent}%;` : ""}text-align:${HTMLAttributes.alignment ?? "left"}`,
  }), 0],
});

const MarkdownTableCell = Node.create({
  name: "markdownTableCell",
  content: "paragraph+",
  addAttributes: () => ({
    widthPercent: { default: null },
    alignment: { default: "left" },
  }),
  parseHTML: () => [{ tag: "td" }],
  renderHTML: ({ HTMLAttributes }) => ["td", mergeAttributes(HTMLAttributes, {
    style: `${HTMLAttributes.widthPercent ? `width:${HTMLAttributes.widthPercent}%;` : ""}text-align:${HTMLAttributes.alignment ?? "left"}`,
  }), 0],
});

const HeadingIds = Extension.create({
  name: "markdownHeadingIds",
  addGlobalAttributes() {
    return [{
      types: ["heading"],
      attributes: {
        id: {
          default: null,
          parseHTML: (element) => element.getAttribute("id"),
          renderHTML: (attributes) => attributes.id ? { id: attributes.id } : {},
        },
        sectionOwner: { default: "", parseHTML: (element) => element.getAttribute("data-section-owner") ?? "", renderHTML: (attributes) => attributes.sectionOwner ? { "data-section-owner": attributes.sectionOwner } : {} },
        sectionStatus: { default: "open", parseHTML: (element) => element.getAttribute("data-section-status") ?? "open", renderHTML: (attributes) => ({ "data-section-status": attributes.sectionStatus || "open" }) },
        sectionDueDate: { default: "", parseHTML: (element) => element.getAttribute("data-section-due-date") ?? "", renderHTML: (attributes) => attributes.sectionDueDate ? { "data-section-due-date": attributes.sectionDueDate } : {} },
      },
    }];
  },
});

function paragraphWithText(transaction: Transaction, text: string) {
  const paragraph = transaction.doc.type.schema.nodes.paragraph;
  return paragraph.create(null, text ? transaction.doc.type.schema.text(text) : undefined);
}

function replaceBlocks(transaction: Transaction, from: number, to: number, node: ProseMirrorNode) {
  const paragraph = paragraphWithText(transaction, "");
  transaction.replaceWith(from, to, Fragment.fromArray([node, paragraph]));
  transaction.setSelection(TextSelection.create(transaction.doc, from + node.nodeSize + 1));
  return true;
}

function convertClosingFence(editor: Editor) {
  const { selection, schema } = editor.state;
  if (!selection.empty || selection.$from.parent.type.name !== "codeBlock") return false;
  const text = selection.$from.parent.textBetween(0, selection.$from.parentOffset);
  const match = text.match(/(?:^|\n)(```|~~~)$/);
  if (!match) return false;

  return editor.chain().command(({ tr }) => {
    const blockStart = tr.selection.$from.before();
    tr.delete(tr.selection.from - match[0].length, tr.selection.from);
    const codeBlock = tr.doc.nodeAt(blockStart);
    if (!codeBlock) return false;
    const insertAt = blockStart + codeBlock.nodeSize;
    if (tr.doc.nodeAt(insertAt)?.type !== schema.nodes.paragraph) {
      tr.insert(insertAt, schema.nodes.paragraph.create());
    }
    tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
    return true;
  }).run();
}

function parseTableRow(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

function convertTable(editor: Editor) {
  const { selection, schema } = editor.state;
  const { $from } = selection;
  if (!selection.empty || $from.depth !== 1 || $from.parent.type.name !== "paragraph") return false;

  const parent = $from.node(0);
  const currentIndex = $from.index(0);
  const rows: Array<{ index: number; cells: string[] }> = [];
  for (let index = currentIndex; index >= 0; index -= 1) {
    const node = parent.child(index);
    if (node.type.name !== "paragraph") break;
    const cells = parseTableRow(node.textContent);
    if (!cells) break;
    rows.unshift({ index, cells });
  }
  if (rows.length < 2) return false;

  const [header, divider, ...body] = rows;
  if (
    !divider.cells.every((cell) => /^:?-{3,}:?$/.test(cell)) ||
    !rows.every((row) => row.cells.length === header.cells.length)
  ) return false;

  const cellNode = (type: "markdownTableHeader" | "markdownTableCell", text: string) =>
    schema.nodes[type].create(null, paragraphWithText(editor.state.tr, text));
  const bodyRows = body.length > 0 ? body : [{ index: -1, cells: header.cells.map(() => "") }];
  const tableRows = [
    schema.nodes.markdownTableRow.create(null, header.cells.map((cell) => cellNode("markdownTableHeader", cell))),
    ...bodyRows.map((row) => schema.nodes.markdownTableRow.create(
      null,
      row.cells.map((cell) => cellNode("markdownTableCell", cell)),
    )),
  ];
  const table = schema.nodes.markdownTable.create(null, tableRows);
  const firstIndex = rows[0].index;
  let from = 0;
  for (let index = 0; index < firstIndex; index += 1) from += parent.child(index).nodeSize;
  const start = from;
  const end = start + rows.reduce((size, row) => size + parent.child(row.index).nodeSize, 0);
  return editor.chain().command(({ tr }) => {
    tr.replaceWith(start, end, table);
    // Place the caret in the first empty data cell so users can continue typing a table naturally.
    const firstBodyParagraph = start + 1 + tableRows[0].nodeSize + 3;
    tr.setSelection(TextSelection.create(tr.doc, firstBodyParagraph));
    return true;
  }).run();
}

function convertImage(editor: Editor) {
  const { selection, schema } = editor.state;
  const { $from } = selection;
  if (!selection.empty || $from.parent.type.name !== "paragraph") return false;
  const match = $from.parent.textContent.match(/^!\[([^\]\n]*)\]\(([^)\s]+)\)$/);
  if (!match || !isAllowedUri(match[2]) || !schema.nodes.commentableImage) return false;
  const image = schema.nodes.commentableImage.create({
    nodeId: crypto.randomUUID(),
    attachmentId: "",
    src: match[2],
    alt: match[1],
    caption: match[1],
  });
  return editor.chain().command(({ tr }) =>
    replaceBlocks(tr, tr.selection.$from.before(), tr.selection.$from.after(), image)).run();
}

function convertHorizontalRule(editor: Editor) {
  const { selection, schema } = editor.state;
  const { $from } = selection;
  if (
    !selection.empty ||
    $from.parent.type.name !== "paragraph" ||
    $from.parent.textContent !== "---"
  ) return false;
  return editor.chain().command(({ tr }) =>
    replaceBlocks(
      tr,
      tr.selection.$from.before(),
      tr.selection.$from.after(),
      schema.nodes.horizontalRule.create(),
    )).run();
}

function convertFootnoteDefinition(editor: Editor) {
  const { selection, schema } = editor.state;
  const { $from } = selection;
  if (!selection.empty || $from.parent.type.name !== "paragraph") return false;
  const match = $from.parent.textContent.match(/^\[\^([A-Za-z0-9_-]+)\]:\s+(.+)$/);
  if (!match) return false;
  const definition = schema.nodes.footnoteDefinition.create(
    { label: match[1] },
    schema.text(match[2]),
  );
  return editor.chain().command(({ tr }) =>
    replaceBlocks(tr, tr.selection.$from.before(), tr.selection.$from.after(), definition)).run();
}

function convertDefinitionList(editor: Editor) {
  const { selection, schema } = editor.state;
  const { $from } = selection;
  if (!selection.empty || $from.depth !== 1 || $from.parent.type.name !== "paragraph") return false;
  const definition = $from.parent.textContent.match(/^:\s+(.+)$/);
  const index = $from.index(0);
  if (!definition || index === 0) return false;
  const previous = $from.node(0).child(index - 1);
  if (previous.type.name !== "paragraph" || !previous.textContent.trim()) return false;

  const list = schema.nodes.definitionList.create(null, [
    schema.nodes.definitionTerm.create(null, schema.text(previous.textContent)),
    schema.nodes.definitionDescription.create(null, schema.text(definition[1])),
  ]);
  return editor.chain().command(({ tr }) => {
    const currentStart = tr.selection.$from.before();
    return replaceBlocks(tr, currentStart - previous.nodeSize, tr.selection.$from.after(), list);
  }).run();
}

function convertHeadingId(editor: Editor, boundary: MarkdownShortcutBoundary) {
  const { selection } = editor.state;
  const { $from } = selection;
  if (!selection.empty || $from.parent.type.name !== "heading") return false;
  const match = $from.parent.textContent.match(/\s+\{#([A-Za-z][\w-]*)\}$/);
  if (!match) return false;

  return editor.chain().command(({ tr }) => {
    const suffixStart = tr.selection.from - match[0].length;
    tr.delete(suffixStart, tr.selection.from);
    tr.setNodeMarkup(tr.selection.$from.before(), undefined, {
      ...tr.selection.$from.parent.attrs,
      id: match[1],
    });
    if (boundary === "space") {
      tr.insertText(" ", suffixStart);
      tr.setSelection(TextSelection.create(tr.doc, suffixStart + 1));
    } else {
      tr.split(suffixStart, 1, [{ type: tr.doc.type.schema.nodes.paragraph }]);
      tr.setSelection(TextSelection.create(tr.doc, suffixStart + 2));
    }
    return true;
  }).run();
}

function convertBlock(editor: Editor, boundary: MarkdownShortcutBoundary) {
  if (boundary === "enter" && convertClosingFence(editor)) return true;
  if (boundary !== "enter") {
    return convertHorizontalRule(editor) || convertImage(editor) || convertHeadingId(editor, boundary);
  }
  return convertTable(editor)
    || convertHorizontalRule(editor)
    || convertImage(editor)
    || convertFootnoteDefinition(editor)
    || convertDefinitionList(editor)
    || convertHeadingId(editor, boundary);
}

function convert(editor: Editor, boundary: MarkdownShortcutBoundary) {
  if (convertBlock(editor, boundary)) return true;
  if (!findMarkdownShortcutAtSelection(editor.state.tr)) return false;
  return editor.chain().command(({ tr }) => applyMarkdownShortcut(tr, boundary)).run();
}

export const MarkdownShortcuts = Extension.create({
  name: "markdownShortcuts",
  priority: 1_000,
  addKeyboardShortcuts() {
    return {
      Space: () => convert(this.editor, "space"),
      Enter: () => convert(this.editor, "enter"),
    };
  },
});

export const MarkdownShortcutMarks = [
  Bold.extend({ addInputRules: () => [] }),
  Italic.extend({ addInputRules: () => [] }),
  Strike.extend({ addInputRules: () => [] }),
  Code.extend({ addInputRules: () => [] }),
  Subscript,
  Superscript,
];

export const MarkdownDocumentExtensions = [
  HeadingIds,
  FootnoteReference,
  FootnoteDefinition,
  DefinitionList,
  DefinitionTerm,
  DefinitionDescription,
  MarkdownTable,
  MarkdownTableRow,
  MarkdownTableHeader,
  MarkdownTableCell,
];
