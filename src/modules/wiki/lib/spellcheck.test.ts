import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { collectSpellcheckParagraphs, mapSpellcheckMatches } from "./spellcheck";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    codeBlock: { group: "block", content: "text*" },
    text: {},
  },
});

describe("wiki spellcheck helpers", () => {
  it("collects normal prose but skips code and URL-only blocks", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("  Das ist falsch.")),
      schema.node("codeBlock", null, schema.text("const typo = true")),
      schema.node("paragraph", null, schema.text("https://example.com")),
      schema.node("paragraph", null, schema.text("English text here.")),
    ]);
    expect(collectSpellcheckParagraphs(doc)).toEqual([
      { text: "Das ist falsch.", from: 3 },
      { text: "English text here.", from: 60 },
    ]);
  });

  it("maps validated LanguageTool offsets into editor positions", () => {
    const paragraphs = [{ text: "Teh sentence", from: 10 }];
    expect(mapSpellcheckMatches(paragraphs, [{ paragraph: 0, offset: 0, length: 3, message: "Possible typo", replacements: ["The"] }])).toEqual([
      { from: 10, to: 13, message: "Possible typo", replacements: ["The"] },
    ]);
    expect(mapSpellcheckMatches(paragraphs, [{ paragraph: 0, offset: 99, length: 2, message: "bad", replacements: [] }])).toEqual([]);
  });
});
