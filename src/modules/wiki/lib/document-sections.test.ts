import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { headingCollapsePlugin, revealHeadingSections } from "../components/collapsible-heading";
import { headingIdentityPlugin } from "../components/heading-identity";
import { documentSections, withDocumentSectionIds } from "./document-sections";
import type { TiptapNode } from "./tiptap";

const heading = (title: string, id?: string): TiptapNode => ({ type: "heading", attrs: { level: 1, id }, content: [{ type: "text", text: title }] });

describe("document section identities", () => {
  it("repairs legacy and duplicate targets deterministically without mutating the document", () => {
    const doc = { type: "doc", content: [heading("A"), heading("B", "section-legacy-1"), heading("C", "section-legacy-1")] };
    const normalized = withDocumentSectionIds(doc);
    expect(documentSections(normalized).map((section) => section.id)).toEqual(["section-legacy-2", "section-legacy-1", "section-legacy-3"]);
    expect(withDocumentSectionIds(doc)).toEqual(normalized);
    expect(withDocumentSectionIds(normalized)).toBe(normalized);
    expect(doc.content[0].attrs?.id).toBeUndefined();
  });

  it("keeps identities when headings are renamed or moved and indexes nested headings", () => {
    const normalized = withDocumentSectionIds({ type: "doc", content: [heading("A"), heading("B")] });
    const first = { ...normalized.content![0], content: [{ type: "text", text: "Renamed" }] };
    const sections = documentSections({ type: "doc", content: [normalized.content![1], { type: "layoutSection", content: [first] }] });
    expect(sections.map((section) => section.id)).toEqual(["section-legacy-2", "section-legacy-1"]);
    expect(sections[1].title).toBe("Renamed");
  });
});

const schema = new Schema({ nodes: {
  doc: { content: "block+" }, text: { group: "inline" },
  paragraph: { group: "block", content: "text*" },
  heading: { group: "block", content: "text*", attrs: { id: { default: null }, level: { default: 1 }, collapsed: { default: false } } },
} });
const original = schema.nodes.heading.create({ id: "stable" }, schema.text("Original"));
const state = () => EditorState.create({ schema, doc: schema.nodes.doc.create(null, [original]), plugins: [headingIdentityPlugin()] });

it("gives a pasted heading a new target even when pasted before the original", () => {
  const before = state();
  const after = before.applyTransaction(before.tr.insert(0, original)).state;
  expect(after.doc.child(1).attrs.id).toBe("stable");
  expect(after.doc.child(0).attrs.id).not.toBe("stable");
  expect(after.doc.child(0).attrs.id).toBeTruthy();
});

it("assigns new headings an identity and keeps it through text edits", () => {
  const before = state();
  const added = before.applyTransaction(before.tr.insert(before.doc.content.size, schema.nodes.heading.create(null, schema.text("New")))).state;
  const id = added.doc.child(1).attrs.id;
  expect(id).toBeTruthy();
  const edited = added.applyTransaction(added.tr.insertText(" changed", added.doc.content.size - 1)).state;
  expect(edited.doc.child(1).attrs.id).toBe(id);
});


it("reveals a linked section without modifying document content or requiring a save", () => {
  const plugin = headingCollapsePlugin();
  const doc = schema.nodes.doc.create(null, [schema.nodes.heading.create({ id: "source", collapsed: true }, schema.text("Source")), schema.nodes.paragraph.create(null, schema.text("Details"))]);
  const before = EditorState.create({ schema, doc, plugins: [plugin] });
  const transaction = revealHeadingSections(before.tr, ["source"]);
  expect(transaction.docChanged).toBe(false);
  const after = before.applyTransaction(transaction).state;
  expect(after.doc.eq(before.doc)).toBe(true);
  expect(plugin.getState(after)?.has("source")).toBe(true);
});
