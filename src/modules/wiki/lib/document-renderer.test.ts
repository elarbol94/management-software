import { describe, expect, it } from "vitest";
import { DOMParser } from "@xmldom/xmldom";
import { DEFAULT_DOCUMENT_SETTINGS } from "./document-settings";
import { renderDocumentHtml, renderDocumentMarkdown } from "./document-renderer";
import type { TiptapNode } from "./tiptap";
import { normalizeWikiTypography } from "./wiki-typography";

it("keeps PDF margin styles intact when font names contain quotes", async () => {
  const rendered = await renderDocumentHtml({ title: "Readable header", doc: { type: "doc", content: [{ type: "paragraph" }] }, settings: DEFAULT_DOCUMENT_SETTINGS });
  for (const template of [rendered.headerTemplate, rendered.footerTemplate]) {
    const element = new DOMParser().parseFromString(template, "text/html").documentElement!;
    const style = element.getAttribute("style");
    expect(style).toContain('"Segoe UI"');
    expect(style).toContain("font:8pt");
    expect(style).toContain("display:grid");
    expect(style).toContain("padding:0 20mm 0 24mm");
  }
});

const doc: TiptapNode = {
  type: "doc",
  content: [
    { type: "tableOfContents", attrs: { title: "Contents", maxLevel: 2 } },
    { type: "heading", attrs: { level: 1, id: "summary" }, content: [{ type: "text", text: "Summary" }] },
    { type: "paragraph", content: [
      { type: "text", text: "A ", marks: [{ type: "bold" }] },
      { type: "documentVariable", attrs: { key: "applicant" } },
      { type: "citation", attrs: { label: "(Example, 2026)", items: [{ sourceId: "source-1" }] } },
    ] },
    { type: "bulletList", content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Bullet" }] }] },
    ] },
    { type: "orderedList", attrs: { start: 3 }, content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Third" }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Fourth" }] }] },
    ] },
    { type: "taskList", content: [
      { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "Open" }] }] },
      { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Done" }] }] },
    ] },
    { type: "pageBreak" },
    { type: "commentableImage", attrs: { nodeId: "figure-one", src: "data:image/png;base64,AA==", alt: "Chart", caption: "Quarterly revenue", includeInFigureIndex: true } },
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
    expect(result.html).toContain('<span class="citation">[1]</span>');
    expect(result.html).not.toContain("(Example, 2026)");
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
    expect(markdown).toContain("[1]");
    expect(markdown).toContain("- Bullet");
    expect(markdown).toContain("3. Third");
    expect(markdown).toContain("4. Fourth");
    expect(markdown).toContain("- [ ] Open");
    expect(markdown).toContain("- [x] Done");
    expect(markdown).toContain("page-break-after");
  });

  it("uses the normalized personal typography instead of stored template typography", async () => {
    const settings = {
      ...DEFAULT_DOCUMENT_SETTINGS,
      theme: {
        ...DEFAULT_DOCUMENT_SETTINGS.theme,
        bodySizePt: 16,
        lineHeight: 2,
        textColor: "#FF0000",
        accentColor: "#00FF00",
      },
      cover: { ...DEFAULT_DOCUMENT_SETTINGS.cover, enabled: false },
    };
    const typography = normalizeWikiTypography({
      bodySizePt: 9,
      lineHeight: 1.35,
      paragraphSpacingEm: 0.4,
      listItemSpacingEm: 0.05,
      listBlockSpacingEm: 0.45,
      listIndentEm: 1.5,
      h1SizeEm: 2.2,
      h2SizeEm: 1.6,
      h3SizeEm: 1.3,
      headingLineHeight: 1.15,
      headingSpacingBeforeEm: 1.1,
      headingSpacingAfterEm: 0.3,
      textColor: "#112233",
      accentColor: "#445566",
      mutedColor: "#778899",
    });
    const result = await renderDocumentHtml({ title: "Proposal", doc, settings, typography });

    expect(result.html).toContain("--body-size: 9pt");
    expect(result.html).toContain("--line-height: 1.35");
    expect(result.html).toContain("--paragraph-spacing: 0.4em");
    expect(result.html).toContain("--list-item-spacing: 0.05em");
    expect(result.html).toContain("--list-block-spacing: 0.45em");
    expect(result.html).toContain("--list-indent: 1.5em");
    expect(result.html).toContain("--heading-before: 1.1em");
    expect(result.html).toContain("--heading-after: 0.3em");
    expect(result.html).toContain("--ink: #112233");
    expect(result.html).not.toContain("--ink: #FF0000");
  });

  it("renders captions in an enabled list of figures", async () => {
    const settings = {
      ...DEFAULT_DOCUMENT_SETTINGS,
      cover: { ...DEFAULT_DOCUMENT_SETTINGS.cover, enabled: false },
      figures: { ...DEFAULT_DOCUMENT_SETTINGS.figures, enabled: true, heading: "Figures" },
    };
    const result = await renderDocumentHtml({ title: "Proposal", doc, settings });
    expect(result.html).toContain('<section class="figure-index">');
    expect(result.html).toContain("Quarterly revenue");
    expect(result.html).toContain('href="#figure-1"');
    expect(result.html).toContain("Figure 1.");
  });

  it("numbers figures in the document language", async () => {
    const settings = {
      ...DEFAULT_DOCUMENT_SETTINGS,
      cover: { ...DEFAULT_DOCUMENT_SETTINGS.cover, enabled: false },
      figures: { ...DEFAULT_DOCUMENT_SETTINGS.figures, enabled: true, heading: "Abbildungen" },
    };
    const result = await renderDocumentHtml({ title: "Antrag", doc, settings, figureLabel: "Abbildung" });
    expect(result.html).toContain("Abbildung 1.");
    expect(result.html).not.toContain("Figure 1");
  });

  it("leaves a caption that already carries its own number unnumbered", async () => {
    const settings = {
      ...DEFAULT_DOCUMENT_SETTINGS,
      cover: { ...DEFAULT_DOCUMENT_SETTINGS.cover, enabled: false },
      figures: { ...DEFAULT_DOCUMENT_SETTINGS.figures, enabled: true },
    };
    const numbered: TiptapNode = {
      type: "doc",
      content: [{
        type: "commentableImage",
        attrs: { nodeId: "figure-own", src: "data:image/png;base64,AA==", alt: "Chart", caption: "Abbildung 4: Hauseigentum nach Gemeindegröße", includeInFigureIndex: true },
      }],
    };
    const result = await renderDocumentHtml({ title: "Antrag", doc: numbered, settings, figureLabel: "Abbildung" });
    expect(result.html).toContain("Abbildung 4: Hauseigentum nach Gemeindegröße");
    expect(result.html).not.toContain("Abbildung 1.");
    expect(result.html).not.toContain('class="figure-number"');
  });

  it("resolves cross-reference labels live from the exported document, ignoring stale stored labels", async () => {
    const settings = { ...DEFAULT_DOCUMENT_SETTINGS, cover: { ...DEFAULT_DOCUMENT_SETTINGS.cover, enabled: false } };
    const referencing: TiptapNode = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1, id: "methodik" }, content: [{ type: "text", text: "Methodik" }] },
        { type: "commentableImage", attrs: { nodeId: "fig-1", src: "data:image/png;base64,AA==", alt: "Chart", caption: "Sparquote", includeInFigureIndex: true } },
        { type: "paragraph", content: [
          { type: "crossReference", attrs: { targetId: "methodik", label: "Old heading title" } },
          { type: "crossReference", attrs: { targetId: "fig-1", label: "Abbildung 7" } },
        ] },
      ],
    };
    const result = await renderDocumentHtml({ title: "Antrag", doc: referencing, settings, figureLabel: "Abbildung", tableLabel: "Tabelle" });
    expect(result.html).toContain('href="#methodik">Methodik</a>');
    expect(result.html).toContain('href="#fig-1">Abbildung 1</a>');
    expect(result.html).not.toContain("Old heading title");
    expect(result.html).not.toContain("Abbildung 7");
  });

  it("makes image paths absolute for a downloaded markdown file", () => {
    const markdown = renderDocumentMarkdown(
      { type: "doc", content: [{ type: "commentableImage", attrs: { src: "/api/wiki/svg-assets/abc/content?v=1.2", alt: "Chart", caption: "" } }] },
      DEFAULT_DOCUMENT_SETTINGS,
      "https://wiki.example.org",
    );
    expect(markdown).toContain("(https://wiki.example.org/api/wiki/svg-assets/abc/content?v=1.2)");
  });
});

describe("mermaid diagrams", () => {
  const settings = DEFAULT_DOCUMENT_SETTINGS;
  const withDiagram = (attrs: Record<string, string>): TiptapNode => ({
    type: "doc",
    content: [{ type: "mermaidDiagram", attrs }],
  });

  it("exports the cached SVG so no mermaid runtime is needed on the server", async () => {
    const result = await renderDocumentHtml({
      title: "Proposal",
      doc: withDiagram({ code: "flowchart TD\n A --> B", svg: "<svg id=\"drawn\"></svg>" }),
      settings,
    });
    expect(result.html).toContain('<figure class="mermaid-diagram">');
    expect(result.html).toContain('<svg id="drawn">');
  });

  it("falls back to the source when nothing was cached, rather than dropping the node", async () => {
    const result = await renderDocumentHtml({
      title: "Proposal",
      doc: withDiagram({ code: "flowchart TD\n A --> B", svg: "" }),
      settings,
    });
    expect(result.html).toContain('<pre class="mermaid-source">');
    expect(result.html).toContain("flowchart TD");
  });

  it("escapes the fallback source", async () => {
    const result = await renderDocumentHtml({
      title: "Proposal",
      doc: withDiagram({ code: "A[<script>alert(1)</script>]", svg: "" }),
      settings,
    });
    expect(result.html).not.toContain("<script>alert(1)</script>");
    expect(result.html).toContain("&lt;script&gt;");
  });

  it("emits a fenced mermaid block in Markdown, keeping the source round-trippable", async () => {
    const markdown = renderDocumentMarkdown(
      withDiagram({ code: "flowchart TD\n  A --> B", svg: "<svg></svg>" }),
      settings,
    );
    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain("A --> B");
    // The rendered SVG is a cache, not content: Markdown carries the source.
    expect(markdown).not.toContain("<svg>");
  });
});
