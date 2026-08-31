import { describe, expect, it } from "vitest";
import {
  collectDocumentPreflightIssues,
  DEFAULT_DOCUMENT_SETTINGS,
  localizeDocumentSettings,
  normalizeDocumentSettings,
  parseDocumentSettings,
  resolveDocumentToken,
} from "./document-settings";

describe("document settings", () => {
  it("normalizes unsafe and out-of-range values", () => {
    const value = normalizeDocumentSettings({
      page: { size: "A3", orientation: "landscape", marginsMm: { top: 1, right: 200, bottom: 20, left: 20 } },
      theme: { bodySizePt: 100, lineHeight: 0, textColor: "red" },
    });
    expect(value.page.size).toBe("A4");
    expect(value.page.orientation).toBe("landscape");
    expect(value.page.marginsMm.top).toBe(8);
    expect(value.page.marginsMm.right).toBe(50);
    expect(value.theme.bodySizePt).toBe(16);
    expect(value.theme.textColor).toBe(DEFAULT_DOCUMENT_SETTINGS.theme.textColor);
  });

  it("falls back for invalid serialized settings", () => {
    expect(parseDocumentSettings("{no")).toEqual(DEFAULT_DOCUMENT_SETTINGS);
  });

  it("keeps margin-guide visibility backward compatible and configurable", () => {
    expect(normalizeDocumentSettings({ page: {} }).page.showMarginGuides).toBe(true);
    expect(normalizeDocumentSettings({ page: { showMarginGuides: false } }).page.showMarginGuides).toBe(false);
  });

  it("localizes untouched generated-section headings without overwriting custom titles", () => {
    const german = localizeDocumentSettings(normalizeDocumentSettings(null), "de-DE");
    expect(german.bibliography.heading).toBe("Literaturverzeichnis");
    expect(german.figures.heading).toBe("Abbildungsverzeichnis");

    const custom = normalizeDocumentSettings({
      bibliography: { heading: "Quellen", enabled: true, pageBreakBefore: true },
    });
    expect(localizeDocumentSettings(custom, "de-DE").bibliography.heading).toBe("Quellen");
  });

  it("reports unresolved variables and section limits", () => {
    const settings = normalizeDocumentSettings({
      ...DEFAULT_DOCUMENT_SETTINGS,
      variables: { ...DEFAULT_DOCUMENT_SETTINGS.variables, applicant: "" },
      constraints: [{
        id: "summary-limit",
        headingId: "summary",
        label: "Summary",
        required: true,
        metric: "words",
        max: 2,
      }],
    });
    const issues = collectDocumentPreflightIssues({
      type: "doc",
      content: [
        { type: "heading", attrs: { id: "summary", level: 1 }, content: [{ type: "text", text: "Summary" }] },
        { type: "paragraph", content: [{ type: "text", text: "one two three" }] },
        { type: "paragraph", content: [{ type: "documentVariable", attrs: { key: "applicant" } }] },
      ],
    }, settings);
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["unresolved-variable", "section-too-long"]));
  });

  it("resolves standard and custom tokens", () => {
    const settings = normalizeDocumentSettings({
      ...DEFAULT_DOCUMENT_SETTINGS,
      variables: { ...DEFAULT_DOCUMENT_SETTINGS.variables, applicant: "Ada" },
    });
    expect(resolveDocumentToken("{title} · {applicant}", settings, { title: "Proposal" })).toBe("Proposal · Ada");
  });

  it("accepts a reference to a captioned figure or table, and flags one to neither", () => {
    const issues = collectDocumentPreflightIssues({
      type: "doc",
      content: [
        { type: "commentableImage", attrs: { nodeId: "figure-1", src: "data:image/png;base64,AA==", caption: "Revenue", includeInFigureIndex: true } },
        { type: "markdownTable", attrs: { tableId: "table-1", caption: "Key results", includeInTableIndex: true } },
        { type: "commentableImage", attrs: { nodeId: "figure-2", src: "data:image/png;base64,AA==", caption: "", includeInFigureIndex: true } },
        { type: "crossReference", attrs: { targetId: "figure-1" } },
        { type: "crossReference", attrs: { targetId: "table-1" } },
        // An image with no caption gets no anchor in the export, so a reference to it is genuinely broken.
        { type: "crossReference", attrs: { targetId: "figure-2" } },
      ],
    }, DEFAULT_DOCUMENT_SETTINGS);
    expect(issues.filter((issue) => issue.code === "broken-cross-reference")).toHaveLength(1);
    expect(issues.find((issue) => issue.code === "broken-cross-reference")?.message).toContain("figure-2");
  });
});
