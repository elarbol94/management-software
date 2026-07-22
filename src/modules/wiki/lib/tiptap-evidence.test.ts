import { describe, expect, it } from "vitest";
import { extractEvidenceAnnotationIds, extractText, type TiptapNode } from "./tiptap";

describe("inline PDF evidence", () => {
  it("deduplicates annotation ids and includes quote text in the wiki search index", () => {
    const doc: TiptapNode = {
      type: "doc",
      content: [
        { type: "pdfEvidence", attrs: { annotationId: "ann-1", quote: "A decisive finding" } },
        { type: "paragraph", content: [{ type: "text", text: "Analysis" }] },
        { type: "pdfEvidence", attrs: { annotationId: "ann-1", quote: "A decisive finding" } },
        { type: "pdfEvidence", attrs: { annotationId: "ann-2", quote: "Second finding" } },
      ],
    };

    expect(extractEvidenceAnnotationIds(doc)).toEqual(["ann-1", "ann-2"]);
    expect(extractText(doc)).toContain("A decisive finding");
  });

  it("ignores malformed evidence nodes", () => {
    expect(extractEvidenceAnnotationIds({ type: "doc", content: [
      { type: "pdfEvidence", attrs: { annotationId: 123 } },
      { type: "pdfEvidence", attrs: {} },
    ] })).toEqual([]);
  });
});
