import { describe, expect, it } from "vitest";
import { Fragment, Schema, Slice } from "@tiptap/pm/model";
import { EditorState, NodeSelection } from "@tiptap/pm/state";
import { history, redo, undo } from "@tiptap/pm/history";
import { canDropFigureInText, dropFigureInText } from "./figure-drop";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", attrs: { alignment: { default: "left" } } },
    text: { group: "inline" },
    commentableImage: { group: "block", atom: true, attrs: { nodeId: {}, caption: {}, wrap: { default: "none" }, crop: { default: null }, widthPercent: { default: 50 } } },
    bulletList: { group: "block", content: "listItem+" },
    listItem: { content: "paragraph block*" },
    table: { group: "block", content: "row+" },
    row: { content: "cell+" },
    cell: { content: "block+", isolating: true },
    codeBlock: { group: "block", content: "text*", code: true },
    heading: { group: "block", content: "inline*" },
  },
  marks: { bold: {}, comment: { attrs: { threadId: {} } } },
});
const figure = schema.nodes.commentableImage.create({ nodeId: "revenue", caption: "Revenue by quarter", wrap: "left", crop: { x: .1, y: .1, width: .8, height: .8 } });
const paragraph = schema.nodes.paragraph.create({ alignment: "justify" }, [schema.text("Before "), schema.text("bold text", [schema.marks.bold.create(), schema.marks.comment.create({ threadId: "thread-1" })]), schema.text(" after.")]);
const slice = new Slice(Fragment.from(figure), 0, 0);

function setup(imageFirst: boolean) {
  const doc = schema.nodes.doc.create(null, imageFirst ? [figure, paragraph] : [paragraph, figure]);
  return EditorState.create({ doc, selection: NodeSelection.create(doc, imageFirst ? 0 : paragraph.nodeSize), plugins: [history()] });
}

describe("dropping figures at a text caret", () => {
  for (const imageFirst of [true, false]) it(`moves an image ${imageFirst ? "forward" : "backward"} inside formatted text`, () => {
    const state = setup(imageFirst);
    const at = (imageFirst ? figure.nodeSize : 0) + 1 + 10;
    const transaction = dropFigureInText(state, at, slice, true)!;
    expect(transaction).not.toBeNull();
    const doc = transaction.doc;
    expect(doc.childCount).toBe(3);
    expect(doc.child(0).textContent).toBe("Before bol");
    expect(doc.child(2).textContent).toBe("d text after.");
    expect(doc.child(1).eq(figure)).toBe(true);
    expect(doc.child(0).content.append(doc.child(2).content).eq(paragraph.content)).toBe(true);
    expect(doc.child(0).attrs).toEqual(paragraph.attrs);
    expect(doc.child(2).attrs).toEqual(paragraph.attrs);
    expect(transaction.selection).toBeInstanceOf(NodeSelection);
    expect((transaction.selection as NodeSelection).node.attrs.nodeId).toBe("revenue");
    doc.check();
  });

  it("undoes and redoes the paragraph split and image move together", () => {
    let state = setup(true);
    const original = state.doc;
    state = state.apply(dropFigureInText(state, 12, slice, true)!);
    const moved = state.doc;
    expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(original)).toBe(true);
    expect(redo(state, tr => { state = state.apply(tr); })).toBe(true);
    expect(state.doc.eq(moved)).toBe(true);
  });

  it("copies with a separate identity while preserving the original", () => {
    const state = setup(true);
    const doc = dropFigureInText(state, 12, slice, false)!.doc;
    expect(doc.firstChild!.eq(figure)).toBe(true);
    expect(doc.child(2).attrs.nodeId).not.toBe("revenue");
    expect(doc.child(2).attrs.caption).toBe(figure.attrs.caption);
    expect(doc.childCount).toBe(4);
  });

  for (const container of ["list", "table"]) it(`splits text inside a ${container} without escaping its container`, () => {
    const wrapped = container === "list"
      ? schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, paragraph))
      : schema.nodes.table.create(null, schema.nodes.row.create(null, schema.nodes.cell.create(null, paragraph)));
    const state = EditorState.create({ doc: schema.nodes.doc.create(null, [figure, wrapped]) });
    let at = 0;
    state.doc.descendants((node, position) => { if (node.type.name === "paragraph") at = position + 8; });
    const doc = dropFigureInText(state, at, slice, true)!.doc;
    expect(doc.childCount).toBe(1);
    const parent = container === "list" ? doc.firstChild!.firstChild! : doc.firstChild!.firstChild!.firstChild!;
    expect(parent.childCount).toBe(3);
    expect(parent.child(1).eq(figure)).toBe(true);
    expect(parent.child(0).content.append(parent.child(2).content).eq(paragraph.content)).toBe(true);
    doc.check();
  });

  it("leaves block boundaries, headings, code, and unrelated drags to the editor", () => {
    const state = setup(true);
    expect(canDropFigureInText(state.doc, 1, figure)).toBe(false);
    expect(canDropFigureInText(state.doc, 2, figure)).toBe(false);
    expect(dropFigureInText(state, 12, new Slice(Fragment.from(schema.text("text")), 0, 0), true)).toBeNull();
    for (const type of ["codeBlock", "heading"]) {
      const doc = schema.nodes.doc.create(null, [figure, schema.nodes[type].create(null, schema.text("Some text"))]);
      expect(canDropFigureInText(doc, 5, figure)).toBe(false);
    }
  });

  it("never deletes a different selection when the dragged image has disappeared", () => {
    const doc = schema.nodes.doc.create(null, paragraph);
    const state = EditorState.create({ doc });
    expect(dropFigureInText(state, 10, slice, true)).toBeNull();
    expect(state.doc.eq(doc)).toBe(true);
  });
});
