import { describe, expect, it } from "vitest";
import { acceptSuggestions, countSuggestions, hasSuggestions, parseDocumentForExport, rejectSuggestions } from "./suggestions";
import type { TiptapNode } from "./tiptap";

const text = (value: string, mark?: string): TiptapNode =>
  mark ? { type: "text", text: value, marks: [{ type: mark }] } : { type: "text", text: value };

// "The old new report" where "old " is proposed for deletion and "new " is proposed.
const doc: TiptapNode = {
  type: "doc",
  content: [{
    type: "paragraph",
    content: [
      text("The "),
      text("old ", "suggestionDelete"),
      text("new ", "suggestionInsert"),
      text("report"),
    ],
  }],
};

const flatten = (node: TiptapNode): string =>
  node.type === "text" ? String(node.text ?? "") : (node.content ?? []).map(flatten).join("");

describe("suggestions", () => {
  it("accepting keeps insertions and drops deletions", () => {
    expect(flatten(acceptSuggestions(doc))).toBe("The new report");
  });

  it("rejecting drops insertions and restores deletions", () => {
    expect(flatten(rejectSuggestions(doc))).toBe("The old report");
  });

  it("strips the suggestion marks it resolves, leaving plain text", () => {
    const accepted = acceptSuggestions(doc);
    expect(JSON.stringify(accepted)).not.toContain("suggestionInsert");
    expect(JSON.stringify(accepted)).not.toContain("suggestionDelete");
  });

  it("preserves other marks on resolved text", () => {
    const bold: TiptapNode = {
      type: "doc",
      content: [{ type: "paragraph", content: [
        { type: "text", text: "kept", marks: [{ type: "bold" }, { type: "suggestionInsert" }] },
      ] }],
    };
    const accepted = acceptSuggestions(bold);
    const node = accepted.content?.[0]?.content?.[0] as TiptapNode & { marks?: Array<{ type: string }> };
    expect(node.marks).toEqual([{ type: "bold" }]);
  });

  it("removes whole blocks that are entirely suggested", () => {
    const block: TiptapNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [text("keep")] },
        { type: "paragraph", marks: [{ type: "suggestionDelete" }], content: [text("gone")] },
      ],
    };
    expect(acceptSuggestions(block).content).toHaveLength(1);
    expect(rejectSuggestions(block).content).toHaveLength(2);
  });

  it("counts pending runs and reports whether any remain", () => {
    expect(countSuggestions(doc)).toEqual({ inserted: 1, deleted: 1 });
    expect(hasSuggestions(doc)).toBe(true);
    expect(hasSuggestions(acceptSuggestions(doc))).toBe(false);
    expect(hasSuggestions(rejectSuggestions(doc))).toBe(false);
  });

  it("leaves a document without suggestions untouched", () => {
    const plain: TiptapNode = { type: "doc", content: [{ type: "paragraph", content: [text("nothing pending")] }] };
    expect(acceptSuggestions(plain)).toEqual(plain);
    expect(rejectSuggestions(plain)).toEqual(plain);
  });
});

describe("parseDocumentForExport", () => {
  it("renders the accepted view, so a deliverable never carries pending marks", () => {
    const stored = JSON.stringify(doc);
    const exported = parseDocumentForExport(stored);
    expect(flatten(exported)).toBe("The new report");
    expect(JSON.stringify(exported)).not.toContain("suggestion");
  });

  it("survives damaged or empty stored content", () => {
    expect(() => parseDocumentForExport("")).not.toThrow();
    expect(() => parseDocumentForExport("not json")).not.toThrow();
  });
});
