import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { findEditorMatches } from "./editor-search";
import { calculateWritingStats } from "./editor-writing";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
  },
});

const doc = schema.node("doc", null, [
  schema.node("paragraph", null, schema.text("Alpha beta alpha.")),
  schema.node("paragraph", null, schema.text("Three more words.")),
]);

describe("editor search and writing utilities", () => {
  it("finds case-insensitive and whole-word matches", () => {
    expect(findEditorMatches(doc, { query: "alpha", caseSensitive: false, wholeWord: true })).toHaveLength(2);
    expect(findEditorMatches(doc, { query: "ALPHA", caseSensitive: true, wholeWord: false })).toHaveLength(0);
  });

  it("calculates document and selection statistics", () => {
    expect(calculateWritingStats(doc)).toMatchObject({ words: 6, readingMinutes: 1 });
    expect(calculateWritingStats(doc, { from: 1, to: 11 }).selectedWords).toBe(2);
  });
});
