import { describe, expect, it } from "vitest";
import { docxHtmlToTiptap } from "./docx-import";

describe("Word import", () => {
  it("preserves whitespace, nested formatting, escaped text and line breaks", () => {
    const doc = docxHtmlToTiptap('<p>Hello <strong>bold <em>and italic</em></strong> world &lt;tag&gt;.<br />Next</p>');
    expect(doc.content?.[0].content).toEqual([
      { type: "text", text: "Hello " },
      { type: "text", text: "bold ", marks: [{ type: "bold" }] },
      { type: "text", text: "and italic", marks: [{ type: "bold" }, { type: "italic" }] },
      { type: "text", text: " world <tag>." },
      { type: "hardBreak" },
      { type: "text", text: "Next" },
    ]);
  });
  it("retains nested lists and gives repeated headings distinct targets", () => {
    const doc = docxHtmlToTiptap('<h1>Overview</h1><h1>Overview</h1><ul><li>Parent<ul><li>Child</li></ul></li><li>Sibling</li></ul>');
    expect(doc.content?.slice(0, 2).map((node) => node.attrs?.id)).toEqual(["overview", "overview-2"]);
    expect(doc.content?.[2].content).toHaveLength(2);
    expect(doc.content?.[2].content?.[0].content?.[1].type).toBe("bulletList");
    expect(JSON.stringify(doc)).toContain("Sibling");
  });
  it("preserves table paragraphs and does not turn a data row into a header", () => {
    const table = docxHtmlToTiptap('<table><tr><td><p>One</p><p>Two</p></td></tr></table>').content?.[0];
    expect(table?.content?.[0].content?.[0].type).toBe("markdownTableCell");
    expect(table?.content?.[0].content?.[0].content).toHaveLength(2);
  });
});
