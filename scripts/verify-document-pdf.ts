import fs from "node:fs";
import path from "node:path";
import { DEFAULT_DOCUMENT_SETTINGS } from "../src/modules/wiki/lib/document-settings";
import { renderDocumentHtml } from "../src/modules/wiki/lib/document-renderer";
import { renderDocumentPdfBytes } from "../src/modules/wiki/lib/document-pdf-engine";
import type { TiptapNode } from "../src/modules/wiki/lib/tiptap";

async function main() {
const outputDirectory = path.join(process.cwd(), "tmp", "pdfs");
fs.mkdirSync(outputDirectory, { recursive: true });

const settings = structuredClone(DEFAULT_DOCUMENT_SETTINGS);
settings.cover = {
  ...settings.cover,
  enabled: true,
  eyebrow: "FUNDING APPLICATION",
  subtitle: "A deterministic document-mode quality check",
};
settings.header = {
  ...settings.header,
  enabled: true,
  left: "{projectTitle}",
  center: "",
  right: "{programme}",
};
settings.footer = {
  ...settings.footer,
  enabled: true,
  left: "{applicant}",
  center: "Confidential",
  right: "",
  pageNumbers: true,
};
settings.variables = {
  ...settings.variables,
  applicant: "Example Research Association",
  projectTitle: "Circular Materials Demonstrator",
  programme: "Innovation Programme 2026",
  date: "24 July 2026",
  fundingPeriod: "2027–2029",
};
settings.metadata = {
  author: "Example Research Association",
  subject: "Funding application",
  keywords: "research, circular materials, demonstrator",
};

const contentJson = JSON.stringify({
  type: "doc",
  content: [
    { type: "tableOfContents", attrs: { title: "Contents", maxLevel: 3 } },
    {
      type: "heading",
      attrs: { level: 1, id: "executive-summary", keepWithNext: true },
      content: [{ type: "text", text: "Executive summary" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "The " },
        { type: "documentVariable", attrs: { key: "projectTitle", label: "projectTitle" } },
        { type: "text", text: " turns industrial side streams into qualified circular raw materials. " },
        { type: "text", text: "This paragraph demonstrates selectable text, emphasis and links.", marks: [{ type: "bold" }] },
      ],
    },
    {
      type: "layoutSection",
      attrs: { columns: 2, gapMm: 8, keepTogether: true },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Objective: validate a robust process window and document environmental benefits." }] },
        { type: "paragraph", content: [{ type: "text", text: "Impact: reduce primary material demand and strengthen regional supply resilience." }] },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2, id: "work-plan", keepWithNext: true },
      content: [{ type: "text", text: "Work plan" }],
    },
    {
      type: "markdownTable",
      attrs: { keepTogether: true },
      content: [
        {
          type: "markdownTableRow",
          content: [
            { type: "markdownTableHeader", attrs: { widthPercent: 28, alignment: "left" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Work package" }] }] },
            { type: "markdownTableHeader", attrs: { widthPercent: 52, alignment: "left" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Deliverable" }] }] },
            { type: "markdownTableHeader", attrs: { widthPercent: 20, alignment: "right" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Month" }] }] },
          ],
        },
        {
          type: "markdownTableRow",
          content: [
            { type: "markdownTableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "WP1" }] }] },
            { type: "markdownTableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Validated feedstock specification" }] }] },
            { type: "markdownTableCell", attrs: { alignment: "right" }, content: [{ type: "paragraph", content: [{ type: "text", text: "6" }] }] },
          ],
        },
        {
          type: "markdownTableRow",
          content: [
            { type: "markdownTableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "WP2" }] }] },
            { type: "markdownTableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Pilot campaign and quality report" }] }] },
            { type: "markdownTableCell", attrs: { alignment: "right" }, content: [{ type: "paragraph", content: [{ type: "text", text: "18" }] }] },
          ],
        },
      ],
    },
    { type: "pageBreak" },
    {
      type: "heading",
      attrs: { level: 2, id: "evidence", keepWithNext: true },
      content: [{ type: "text", text: "Evidence and references" }],
    },
    {
      type: "pdfEvidence",
      attrs: {
        quote: "Pilot trials reached stable product quality across the target operating window.",
        sourceTitle: "Pilot campaign report",
        pageNumber: 14,
      },
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Supporting project website", marks: [{ type: "link", attrs: { href: "https://example.com/project" } }] },
        { type: "text", text: " and a footnote" },
        { type: "footnoteReference", attrs: { label: "1" } },
        { type: "text", text: "." },
      ],
    },
    {
      type: "footnoteDefinition",
      attrs: { label: "1" },
      content: [{ type: "text", text: "All figures in this verification document are illustrative." }],
    },
  ],
});

const title = "Circular Materials Demonstrator";
const rendered = await renderDocumentHtml({
  title,
  doc: JSON.parse(contentJson) as TiptapNode,
  settings,
});
const result = await renderDocumentPdfBytes({
  rendered,
  settings,
  metadata: {
    title,
    author: settings.metadata.author,
    subject: settings.metadata.subject,
    keywords: settings.metadata.keywords,
  },
});
const outputPath = path.join(outputDirectory, "document-mode-verification.pdf");
fs.writeFileSync(outputPath, result);
console.log(outputPath);
}

void main();
