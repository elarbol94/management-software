import { describe, expect, it } from "vitest";
import { looksLikeMarkdown, parseMarkdownDocument, parseMarkdownInline } from "./markdown-import";

describe("Markdown document import", () => {
  it("detects structured Markdown but leaves ordinary prose alone", () => {
    expect(looksLikeMarkdown("# Heading\n\nText")).toBe(true);
    expect(looksLikeMarkdown("An ordinary sentence without markup.")).toBe(false);
  });

  it("parses inline formatting and links", () => {
    const nodes = parseMarkdownInline("**bold** *italic* [site](https://example.com) :joy:");
    expect(nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "bold", marks: [{ type: "bold" }] }),
      expect.objectContaining({ text: "italic", marks: [{ type: "italic" }] }),
      expect.objectContaining({ text: "site", marks: [expect.objectContaining({ type: "link" })] }),
      expect.objectContaining({ text: "😂" }),
    ]));
  });

  it("parses headings, tasks, tables, code, definitions, images, and footnotes", () => {
    const doc = parseMarkdownDocument([
      "## Heading {#heading}",
      "- [x] Done",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "```",
      "const value = 1",
      "```",
      "Term",
      ": Definition",
      "![Alt](/image.png)",
      "[^1]: Footnote",
    ].join("\n"), () => "node-1");
    const types = doc.content?.map((node) => node.type);
    expect(types).toEqual(expect.arrayContaining(["heading", "taskList", "markdownTable", "codeBlock", "definitionList", "commentableImage", "footnoteDefinition"]));
    expect(doc.content?.find((node) => node.type === "heading")?.attrs).toMatchObject({ id: "heading", level: 2 });
    expect(doc.content?.find((node) => node.type === "commentableImage")?.attrs).toMatchObject({ nodeId: "node-1", src: "/image.png" });
  });
});
