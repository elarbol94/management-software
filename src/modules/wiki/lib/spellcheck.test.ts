import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import { createSpellcheckPlugin, replaceAllSpellcheckOccurrences, spellcheckKey, type SpellcheckIssue } from "./spellcheck";
import { PROOFING_LANGUAGES, SPELLCHECK_BATCH_MAX_CHARACTERS, SPELLCHECK_BATCH_MAX_PARAGRAPHS, collectSpellcheckParagraphs, createSpellcheckBatches, mapSpellcheckMatches, nextProofingLanguage, remapSpellcheckBatchMatches } from "./spellcheck";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    codeBlock: { group: "block", content: "text*" },
    text: { group: "inline" },
    hardBreak: { inline: true, group: "inline" },
    citation: { inline: true, group: "inline", atom: true },
  },
  marks: { bold: {}, code: {}, link: {} },
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

  it("cycles the proofing language through de-DE, en-US, and de-AT and back", () => {
    expect(nextProofingLanguage("de-DE")).toBe("en-US");
    expect(nextProofingLanguage("en-US")).toBe("de-AT");
    expect(nextProofingLanguage("de-AT")).toBe("de-DE");
    expect(PROOFING_LANGUAGES).toEqual(["de-DE", "en-US", "de-AT"]);
  });

  it("keeps offsets after hard breaks and inline citations, and checks prose after URLs", () => {
    const doc = schema.node("doc", null, [schema.node("paragraph", null, [
      schema.text("https://example.com "), schema.node("citation"), schema.node("hardBreak"),
      schema.text("Fe"), schema.text("ler", [schema.mark("bold")]), schema.text(" codee", [schema.mark("code")]),
    ])]);
    const paragraphs = collectSpellcheckParagraphs(doc);
    const matches = mapSpellcheckMatches(paragraphs, [{ paragraph: 0, offset: paragraphs[0].text.indexOf("Feler"), length: 5, message: "Typo", kind: "spelling", category: "", ruleId: "TYPO", replacements: ["Fehler"] }]);
    expect(matches).toHaveLength(1);
    expect(doc.textBetween(matches[0].from, matches[0].to)).toBe("Feler");
    expect(paragraphs[0].excludedRanges).toEqual([{ from: 20, to: 21 }, { from: 21, to: 22 }, { from: 27, to: 33 }]);
  });

  it("invalidates edited words immediately and reuses decorations for selection changes", () => {
    const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("Feler")), schema.node("paragraph", null, schema.text("Feler"))]);
    const issue: SpellcheckIssue = { from: 1, to: 6, message: "Typo", kind: "spelling", category: "", ruleId: "TYPO", replacements: ["Fehler"] };
    let state = EditorState.create({ doc, plugins: [createSpellcheckPlugin(() => {})] });
    state = state.apply(state.tr.setMeta(spellcheckKey, [issue, { ...issue, from: 8, to: 13 }]));
    const cached = spellcheckKey.getState(state);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
    expect(spellcheckKey.getState(state)).toBe(cached);
    state = state.apply(state.tr.insertText("h", 3));
    expect(spellcheckKey.getState(state)?.issues).toEqual([{ ...issue, from: 9, to: 14 }]);
    expect(state.doc.textBetween(9, 14)).toBe("Feler");
  });

  it("keeps other spelling hints in the same paragraph and holds context-dependent grammar", () => {
    const doc = schema.node("doc", null, schema.node("paragraph", null, schema.text("Feler Feler falsch")));
    const issue: SpellcheckIssue = { from: 1, to: 6, message: "Typo", kind: "spelling", category: "", ruleId: "TYPO", replacements: ["Fehler"] };
    let state = EditorState.create({ doc, plugins: [createSpellcheckPlugin(() => {})] });
    state = state.apply(state.tr.setMeta(spellcheckKey, [issue, { ...issue, from: 7, to: 12 }, { ...issue, from: 13, to: 19, kind: "writing" }]));
    state = state.apply(state.tr.insertText("Fehler", 1, 6));
    expect(spellcheckKey.getState(state)?.issues).toEqual([
      { ...issue, from: 8, to: 13 }, { ...issue, from: 14, to: 20, kind: "writing", pending: true },
    ]);
    expect(state.doc.textBetween(8, 13)).toBe("Feler");
    // Two steps in one transaction still map against each step's document.
    state = state.apply(state.tr.insertText("Ein ", 1).insertText("h", 14));
    expect(spellcheckKey.getState(state)?.issues).toEqual([{ ...issue, from: 19, to: 25, kind: "writing", pending: true }]);
  });

  it("never bulk-applies grammar suggestions whose context is pending", () => {
    const doc = schema.node("doc", null, schema.node("paragraph", null, schema.text("Teh Teh")));
    const issue: SpellcheckIssue = { from: 1, to: 4, message: "Grammar", kind: "writing", category: "", ruleId: "GRAMMAR", replacements: ["The"] };
    let state = EditorState.create({ doc, plugins: [createSpellcheckPlugin(() => {})] });
    state = state.apply(state.tr.setMeta(spellcheckKey, [issue, { ...issue, from: 5, to: 8, pending: true }]));
    const editor = { get state() { return state; }, isEditable: true, view: { dispatch: (tr: Transaction) => { state = state.apply(tr); } } } as unknown as Editor;
    expect(replaceAllSpellcheckOccurrences(editor, issue, "The")).toBe(1);
    expect(state.doc.textContent).toBe("The Teh");
  });

  it("keeps a word's hint when typing a space, but removes it when the word is extended or joined", () => {
    const doc = schema.node("doc", null, schema.node("paragraph", null, schema.text("Feler")));
    const issue: SpellcheckIssue = { from: 1, to: 6, message: "Typo", kind: "spelling", category: "", ruleId: "TYPO", replacements: ["Fehler"] };
    let state = EditorState.create({ doc, plugins: [createSpellcheckPlugin(() => {})] });
    state = state.apply(state.tr.setMeta(spellcheckKey, [issue]));
    state = state.apply(state.tr.insertText(" ", 6));
    expect(spellcheckKey.getState(state)?.issues).toEqual([issue]);
    state = state.apply(state.tr.insertText("Vor ", 1));
    expect(spellcheckKey.getState(state)?.issues).toEqual([{ ...issue, from: 5, to: 10 }]);
    const joined = state.apply(state.tr.delete(4, 5));
    expect(spellcheckKey.getState(joined)?.issues).toEqual([]);
    state = state.apply(state.tr.insertText("chen", 10));
    expect(spellcheckKey.getState(state)?.issues).toEqual([]);
  });

  it("replace all changes only matching marked occurrences, including formatted words", () => {
    const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("Te"), schema.text("h", [schema.mark("bold")]), schema.text(" TehOther Teh")])]);
    const issue: SpellcheckIssue = { from: 1, to: 4, message: "Typo", kind: "spelling", category: "", ruleId: "TYPO", replacements: ["The"] };
    let state = EditorState.create({ doc, plugins: [createSpellcheckPlugin(() => {})] });
    state = state.apply(state.tr.setMeta(spellcheckKey, [issue, { ...issue, from: 14, to: 17 }]));
    const editor = { get state() { return state; }, isEditable: true, view: { dispatch: (tr: Transaction) => { state = state.apply(tr); } } } as unknown as Editor;
    expect(replaceAllSpellcheckOccurrences(editor, issue, "The")).toBe(2);
    expect(state.doc.textContent).toBe("The TehOther The");
  });
});
