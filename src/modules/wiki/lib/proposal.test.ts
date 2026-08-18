import { describe, expect, it } from "vitest";
import { docxHtmlToTiptap } from "./docx-import";
import { collectDocumentPreflightIssues, normalizeDocumentSettings } from "./document-settings";
import { proposalSectionSnippet, proposalStarterContent, proposalTable } from "./proposal";
import { renderDocumentHtml } from "./document-renderer";

describe("proposal documents", () => {
  it("creates structured proposal starters with editable tables", () => {
    const document = proposalStarterContent("funding");
    expect(document.type).toBe("doc");
    expect(document.content?.some((node) => node.type === "markdownTable")).toBe(true);
    expect(document.content?.filter((node) => node.type === "heading").every((node) => node.attrs?.id)).toBe(true);
  });

  it("checks submission requirements and accepts proposal blocks", () => {
    const settings = normalizeDocumentSettings({
      submission: { maxWords: 2, requiredAnnexes: ["financials"], requireBudget: true, requireSignature: true, requireCitations: true },
    });
    const incomplete = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "too many words here" }] }] };
    expect(collectDocumentPreflightIssues(incomplete, settings).map((issue) => issue.code)).toEqual(expect.arrayContaining(["word-limit", "missing-budget", "missing-signature", "missing-citation", "missing-annex"]));

    const complete = { type: "doc", content: [proposalTable("budget"), { type: "citation", attrs: { label: "[1]" } }, { type: "signatureBlock" }, { type: "annexMarker", attrs: { annexId: "financials" } }] };
    const relaxed = normalizeDocumentSettings({ ...settings, submission: { ...settings.submission, maxWords: null } });
    expect(collectDocumentPreflightIssues(complete, relaxed).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("imports common Word structure", () => {
    const document = docxHtmlToTiptap("<h1>Plan</h1><p><strong>Bold</strong> text</p><table><tr><th>Cost</th></tr><tr><td>10</td></tr></table>");
    expect(document.content?.map((node) => node.type)).toEqual(["heading", "paragraph", "markdownTable"]);
    expect(document.content?.[1].content?.[0].marks?.[0].type).toBe("bold");
    const encoded = docxHtmlToTiptap("<table><tr><td><p>Cost</p></td></tr></table><table><tr><td>&lt;p&gt;Cost&lt;/p&gt;</td></tr></table>");
    expect(encoded.content?.[0].content?.[0].content?.[0].content?.[0].content?.[0].text).toBe("Cost");
  });

  it("keeps typed fields compatible and creates reusable sections", () => {
    const settings = normalizeDocumentSettings({ variables: { date: "2026-08-18", totalBudget: "12500" } });
    expect(settings.variableDefinitions.date.type).toBe("date");
    expect(settings.variableDefinitions.totalBudget.type).toBe("currency");
    expect(proposalSectionSnippet("decision").map((node) => node.type)).toEqual(["heading", "paragraph"]);
  });

  it("renders numbered headings, callouts, table captions, and a table index", async () => {
    const table = proposalTable("budget");
    table.attrs = { ...table.attrs, caption: "Project budget" };
    const settings = normalizeDocumentSettings({ page: { numberedHeadings: true }, tables: { enabled: true, heading: "Tables", pageBreakBefore: true }, variables: { date: "2026-08-18", totalBudget: "12500.50" } });
    const rendered = await renderDocumentHtml({
      title: "Proposal",
      settings,
      tableLabel: "Tabelle",
      doc: { type: "doc", content: [
        { type: "heading", attrs: { level: 1, id: "scope" }, content: [{ type: "text", text: "Scope" }] },
        { type: "proposalCallout", attrs: { kind: "decision", title: "Decision" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Approve." }] }] },
        table,
        { type: "paragraph", content: [{ type: "documentVariable", attrs: { key: "date" } }, { type: "text", text: " · " }, { type: "documentVariable", attrs: { key: "totalBudget" } }] },
      ] },
    });
    expect(rendered.bodyHtml).toContain("numbered-headings");
    expect(rendered.bodyHtml).toContain("proposal-callout-decision");
    expect(rendered.bodyHtml).toContain("Project budget");
    expect(rendered.bodyHtml).toContain("table-index");
    expect(rendered.bodyHtml).toContain("Tabelle 1");
    expect(rendered.bodyHtml).toContain("18.08.2026");
    expect(rendered.bodyHtml).toContain("12.500,50");
  });
});
