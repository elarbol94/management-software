import { z } from "zod";

const contributorSchema = z.object({
  role: z.enum(["author", "editor"]),
  given: z.string().max(120),
  family: z.string().max(120),
  literal: z.string().max(240),
});

export const sourceInputSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["journalArticle", "book", "bookChapter", "report", "webPage", "document"]),
  documentType: z.string().trim().max(120).default(""),
  title: z.string().trim().min(1).max(500),
  subtitle: z.string().max(500).default(""),
  issuedDate: z.string().max(20).default(""),
  containerTitle: z.string().max(500).default(""),
  publisher: z.string().max(300).default(""),
  institution: z.string().max(300).default(""),
  edition: z.string().max(80).default(""),
  volume: z.string().max(80).default(""),
  issue: z.string().max(80).default(""),
  pages: z.string().max(80).default(""),
  doi: z.string().max(300).default(""),
  isbn: z.string().max(40).default(""),
  url: z.string().max(2000).default(""),
  accessedAt: z.string().max(20).default(""),
  language: z.string().max(40).default(""),
  abstract: z.string().max(20_000).default(""),
  notes: z.string().max(20_000).default(""),
  readingStatus: z.enum(["toRead", "reading", "read"]).default("toRead"),
  contributors: z.array(contributorSchema).max(100).default([]),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
});

/**
 * A `.json` file sitting next to a graphic in the synced folder, holding the
 * Literaturstelle for it. Same shape as a source, minus the id (a sidecar may
 * never point at an existing record), plus the ready-made figure caption.
 */
export const graphicsSidecarSchema = sourceInputSchema.omit({ id: true }).extend({
  caption: z.string().trim().max(2_000).default(""),
});
