import type { Editor } from "@tiptap/react";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

type LocatedNode = {
  depth: number;
  node: ProseMirrorNode;
  position: number;
  index: number;
};

function ancestor(editor: Editor, typeName: string): LocatedNode | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name !== typeName) continue;
    return {
      depth,
      node: $from.node(depth),
      position: $from.before(depth),
      index: $from.index(depth - 1),
    };
  }
  return null;
}

function children(node: ProseMirrorNode) {
  return Array.from({ length: node.childCount }, (_, index) => node.child(index));
}

function emptyCell(editor: Editor, typeName = "markdownTableCell", attrs: Record<string, unknown> = {}) {
  const paragraph = editor.schema.nodes.paragraph.create();
  return editor.schema.nodes[typeName].create(attrs, paragraph);
}

function replaceTable(
  editor: Editor,
  table: LocatedNode,
  rows: ProseMirrorNode[],
  selectionOffset = 3,
) {
  const replacement = table.node.copy(Fragment.fromArray(rows));
  return editor.chain().focus().command(({ tr }) => {
    tr.replaceWith(table.position, table.position + table.node.nodeSize, replacement);
    const target = Math.min(
      table.position + replacement.nodeSize - 2,
      Math.max(table.position + 1, table.position + selectionOffset),
    );
    tr.setSelection(TextSelection.near(tr.doc.resolve(target)));
    return true;
  }).run();
}

export function isInMarkdownTable(editor: Editor) {
  return Boolean(ancestor(editor, "markdownTable"));
}

export function addMarkdownTableRow(editor: Editor) {
  const table = ancestor(editor, "markdownTable");
  const row = ancestor(editor, "markdownTableRow");
  if (!table || !row) return false;
  const tableRows = children(table.node);
  const reference = tableRows[row.index] ?? tableRows.at(-1);
  if (!reference) return false;
  const cells = children(reference).map((cell) =>
    emptyCell(editor, "markdownTableCell", {
      ...cell.attrs,
      alignment: cell.attrs.alignment ?? "left",
    }));
  tableRows.splice(row.index + 1, 0, editor.schema.nodes.markdownTableRow.create(null, cells));
  const precedingSize = tableRows.slice(0, row.index + 1).reduce((sum, item) => sum + item.nodeSize, 0);
  return replaceTable(editor, table, tableRows, precedingSize + 3);
}

export function deleteMarkdownTableRow(editor: Editor) {
  const table = ancestor(editor, "markdownTable");
  const row = ancestor(editor, "markdownTableRow");
  if (!table || !row || table.node.childCount <= 1) return false;
  const rows = children(table.node);
  rows.splice(row.index, 1);
  const targetRow = Math.max(0, Math.min(row.index, rows.length - 1));
  const precedingSize = rows.slice(0, targetRow).reduce((sum, item) => sum + item.nodeSize, 0);
  return replaceTable(editor, table, rows, precedingSize + 3);
}

export function addMarkdownTableColumn(editor: Editor) {
  const table = ancestor(editor, "markdownTable");
  const cell = ancestor(editor, "markdownTableCell") ?? ancestor(editor, "markdownTableHeader");
  if (!table || !cell) return false;
  const columnIndex = cell.index;
  const rows = children(table.node).map((row, rowIndex) => {
    const cells = children(row);
    const reference = cells[Math.min(columnIndex, cells.length - 1)];
    const typeName = rowIndex === 0 && reference?.type.name === "markdownTableHeader"
      ? "markdownTableHeader"
      : "markdownTableCell";
    cells.splice(
      columnIndex + 1,
      0,
      emptyCell(editor, typeName, {
        widthPercent: reference?.attrs.widthPercent ?? null,
        alignment: reference?.attrs.alignment ?? "left",
      }),
    );
    return row.copy(Fragment.fromArray(cells));
  });
  return replaceTable(editor, table, rows);
}

export function deleteMarkdownTableColumn(editor: Editor) {
  const table = ancestor(editor, "markdownTable");
  const cell = ancestor(editor, "markdownTableCell") ?? ancestor(editor, "markdownTableHeader");
  if (!table || !cell || table.node.firstChild?.childCount === 1) return false;
  const rows = children(table.node).map((row) => {
    const cells = children(row);
    cells.splice(Math.min(cell.index, cells.length - 1), 1);
    return row.copy(Fragment.fromArray(cells));
  });
  return replaceTable(editor, table, rows);
}

export function toggleMarkdownTableHeader(editor: Editor) {
  const table = ancestor(editor, "markdownTable");
  if (!table || !table.node.firstChild) return false;
  const rows = children(table.node);
  const first = rows[0];
  const currentlyHeader = first.childCount > 0
    && Array.from({ length: first.childCount }, (_, index) => first.child(index))
      .every((cell) => cell.type.name === "markdownTableHeader");
  const cells = children(first).map((cell) =>
    editor.schema.nodes[currentlyHeader ? "markdownTableCell" : "markdownTableHeader"]
      .create(cell.attrs, cell.content));
  rows[0] = first.copy(Fragment.fromArray(cells));
  return replaceTable(editor, table, rows);
}

export function setMarkdownTableCellAlignment(
  editor: Editor,
  alignment: "left" | "center" | "right",
) {
  const cell = ancestor(editor, "markdownTableCell") ?? ancestor(editor, "markdownTableHeader");
  if (!cell) return false;
  return editor.chain().focus().updateAttributes(cell.node.type.name, { alignment }).run();
}

