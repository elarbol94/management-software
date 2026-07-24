import { describe, expect, it } from "vitest";
import { DEFAULT_DOCUMENT_SETTINGS } from "./document-settings";
import { renderDocumentHtml, renderDocumentMarkdown } from "./document-renderer";
import type { TiptapNode } from "./tiptap";

const doc: TiptapNode = {
  type: "doc",
  content: [
    { type: "tableOfContents", attrs: { title: "Contents", maxLevel: 2 } },
    { type: "heading", attrs: { level: 1, id: "summary" }, content: [{ type: "text", text: "Summary" }] },
    { type: "paragraph", content: [
      { type: "text", text: "A ", marks: [{ type: "bold" }] },
      { type: "documentVariable", attrs: { key: "applicant" } },
      { type: "citation", attrs: { label: "(Example, 2026)" } },
    ] },
    { type: "pageBreak" },
    { type: "markdownTable", content: [
      { type: "markdownTableRow", content: [{ type: "markdownTableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Item" }] }] }] },
      { type: "markdownTableRow", content: [{ type: "markdownTableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Result" }] }] }] },
    ] },
  ],
};

describe("document renderer", () => {
  it("renders structured HTML, TOC, variables and repeated table headers", async () => {
    const settings = {
      ...DEFAULT_DOCUMENT_SETTINGS,
      cover: { ...DEFAULT_DOCUMENT_SETTINGS.cover, enabled: false },
      variables: { ...DEFAULT_DOCUMENT_SETTINGS.variables, applicant: "Ada" },
    };
    const result = await renderDocumentHtml({ title: "Proposal", doc, settings });
    expect(result.html).toContain('<h1 id="summary"');
    expect(result.html).toContain("Ada");
    expect(result.html).toContain("<thead>");
    expect(result.html).toContain('href="#summary"');
    expect(result.html).not.toContain("data-comment");
  });

  it("keeps document structure in Markdown", () => {
    const markdown = renderDocumentMarkdown(doc, {
      ...DEFAULT_DOCUMENT_SETTINGS,
      variables: { ...DEFAULT_DOCUMENT_SETTINGS.variables, applicant: "Ada" },
    });
    expect(markdown).toContain("# Summary");
    expect(markdown).toContain("Ada");
    expect(markdown).toContain("page-break-after");
  });
});
