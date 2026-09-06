import { describe, expect, it } from "vitest";
import { stripPageSpecificContent } from "./document-template";

describe("document template skeletons", () => {
  it("strips all children instead of bringing back the original evidence", () => {
    const cleaned = stripPageSpecificContent({ type: "doc", content: [
      { type: "heading", content: [{ type: "text", text: "Outline", marks: [{ type: "comment" }, { type: "bold" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "Private content" }] },
      { type: "footnoteDefinition", content: [{ type: "citation", attrs: { sourceId: "source" } }] },
      { type: "commentableImage", attrs: { attachmentId: "private-file" } },
    ] });
    const json = JSON.stringify(cleaned);
    expect(json).toContain("Outline");
    expect(json).toContain("bold");
    for (const text of ["Private content", "citation", "source", "comment", "private-file"]) expect(json).not.toContain(text);
  });
});
