import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { SPELLCHECK_BATCH_MAX_CHARACTERS, SPELLCHECK_BATCH_MAX_PARAGRAPHS, collectSpellcheckParagraphs, createSpellcheckBatches, mapSpellcheckMatches, remapSpellcheckBatchMatches } from "./spellcheck";

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
      { text: "Das ist falsch.", from: 3, excludedRanges: [] },
      { text: "English text here.", from: 60, excludedRanges: [] },
    ]);
  });

  it("maps validated LanguageTool offsets into editor positions", () => {
    const paragraphs = [{ text: "Teh sentence", from: 10, excludedRanges: [] }];
    expect(mapSpellcheckMatches(paragraphs, [{ paragraph: 0, offset: 0, length: 3, message: "Possible typo", kind: "spelling", category: "Typos", ruleId: "TYPOS", replacements: ["The"] }])).toEqual([
      { from: 10, to: 13, message: "Possible typo", kind: "spelling", category: "Typos", ruleId: "TYPOS", replacements: ["The"] },
    ]);
    expect(mapSpellcheckMatches(paragraphs, [{ paragraph: 0, offset: 99, length: 2, message: "bad", kind: "writing", category: "Grammar", ruleId: "GRAMMAR", replacements: [] }])).toEqual([]);
  });

  it("ignores URLs, emails, file names, acronyms, and excluded inline ranges", () => {
    const paragraphs = [{ text: "API test@example.com report.pdf Feler codee", from: 1, excludedRanges: [{ from: 38, to: 43 }] }];
    const matches = [
      { paragraph: 0, offset: 0, length: 3, message: "Acronym", kind: "spelling" as const, category: "Typos", ruleId: "A", replacements: [] },
      { paragraph: 0, offset: 4, length: 16, message: "Email", kind: "spelling" as const, category: "Typos", ruleId: "B", replacements: [] },
      { paragraph: 0, offset: 21, length: 10, message: "File", kind: "spelling" as const, category: "Typos", ruleId: "C", replacements: [] },
      { paragraph: 0, offset: 32, length: 5, message: "Typo", kind: "spelling" as const, category: "Typos", ruleId: "D", replacements: ["Fehler"] },
      { paragraph: 0, offset: 38, length: 5, message: "Inline code", kind: "spelling" as const, category: "Typos", ruleId: "E", replacements: [] },
    ];
    expect(mapSpellcheckMatches(paragraphs, matches)).toEqual([
      { from: 33, to: 38, message: "Typo", kind: "spelling", category: "Typos", ruleId: "D", replacements: ["Fehler"] },
    ]);
  });

  it("chunks every paragraph within API limits and remaps long-paragraph offsets", () => {
    const paragraphs = Array.from({ length: 161 }, (_, index) => ({ text: "p" + index, from: index * 10, excludedRanges: [] }));
    const batches = createSpellcheckBatches(paragraphs);
    expect(batches).toHaveLength(3);
    for (const batch of batches) {
      expect(batch.items.length).toBeLessThanOrEqual(SPELLCHECK_BATCH_MAX_PARAGRAPHS);
      expect(batch.items.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(SPELLCHECK_BATCH_MAX_CHARACTERS);
    }

    const longBatches = createSpellcheckBatches([{ text: "x".repeat(25_000), from: 1, excludedRanges: [] }]);
    expect(longBatches).toHaveLength(2);
    expect(remapSpellcheckBatchMatches(longBatches[1], [{ paragraph: 0, offset: 3, length: 2, message: "Late issue", kind: "writing", category: "Grammar", ruleId: "GRAMMAR", replacements: [] }])).toEqual([
      { paragraph: 0, offset: 24_003, length: 2, message: "Late issue", kind: "writing", category: "Grammar", ruleId: "GRAMMAR", replacements: [] },
    ]);
  });
});
