// Pure helpers for walking Tiptap JSON documents (no Tiptap dependency, so
// they run server-side and in unit tests without an editor instance).

export type TiptapNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
};

export type CitationItem = {
  sourceId: string;
  annotationId?: string;
  locator?: string;
  locatorType?: "page" | "chapter" | "timestamp";
  prefix?: string;
  suffix?: string;
};

/** Converts current JSON and legacy empty/plain-text revision payloads into a valid Tiptap document. */
export function parseStoredDocument(value: string): TiptapNode {
  const paragraph = (text = ""): TiptapNode => ({
    type: "paragraph",
    ...(text ? { content: [{ type: "text", text }] } : {}),
  });
  const fallback = (text: string): TiptapNode => ({
    type: "doc",
    content: (text.split(/\r?\n/) || [""]).map((line) => paragraph(line)),
  });
  if (!value.trim()) return fallback("");
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && (parsed as TiptapNode).type === "doc") return parsed as TiptapNode;
    if (typeof parsed === "string") return fallback(parsed);
    return fallback(value);
  } catch {
    return fallback(value);
  }
}

/** Extracts plain text for the FTS index. Blocks are joined with newlines. */
export function extractText(doc: TiptapNode | null | undefined): string {
  if (!doc) return "";
  const blocks: string[] = [];

  function walkBlock(node: TiptapNode): string {
    if (node.text) return node.text;
    if (node.type === "citation" && typeof node.attrs?.label === "string") return node.attrs.label;
    if (node.type === "pdfEvidence" && typeof node.attrs?.quote === "string") return node.attrs.quote;
    if (!node.content) return "";
    return node.content.map(walkBlock).join("");
  }

  function walk(node: TiptapNode) {
    if (!node.content) return;
    for (const child of node.content) {
      if (child.content?.some((n) => n.content)) {
        walk(child); // nested blocks (lists, blockquotes)
      } else {
        const text = walkBlock(child).trim();
        if (text) blocks.push(text);
      }
    }
  }

  walk(doc);
  return blocks.join("\n");
}

/** Collects slugs from legacy and canonical internal wiki page links. */
export function extractInternalSlugs(doc: TiptapNode | null | undefined): string[] {
  if (!doc) return [];
  const slugs = new Set<string>();

  function walk(node: TiptapNode) {
    for (const mark of node.marks ?? []) {
      if (mark.type === "link") {
        const href = String(mark.attrs?.href ?? "");
        const match = href.match(/^\/wiki\/(?:pages\/)?([^/?#]+)$/);
        if (match) slugs.add(decodeURIComponent(match[1]));
      }
    }
    for (const child of node.content ?? []) walk(child);
  }

  walk(doc);
  return [...slugs];
}

/** Collects structured citations from inline citation nodes. */
export function extractCitations(doc: TiptapNode | null | undefined): CitationItem[] {
  if (!doc) return [];
  const citations: CitationItem[] = [];
  function walk(node: TiptapNode) {
    if (node.type === "citation") {
      const raw = node.attrs?.items;
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (item && typeof item === "object" && typeof item.sourceId === "string") {
            citations.push(item as CitationItem);
          }
        }
      } else if (typeof node.attrs?.sourceId === "string") {
        citations.push({
          sourceId: node.attrs.sourceId,
          locator: typeof node.attrs.locator === "string" ? node.attrs.locator : undefined,
          locatorType: node.attrs.locatorType as CitationItem["locatorType"],
        });
      }
    }
    for (const child of node.content ?? []) walk(child);
  }
  walk(doc);
  return citations;
}

/** Collects annotation ids referenced by inline PDF evidence nodes. */
export function extractEvidenceAnnotationIds(doc: TiptapNode | null | undefined): string[] {
  if (!doc) return [];
  const ids = new Set<string>();
  function walk(node: TiptapNode) {
    if (node.type === "pdfEvidence" && typeof node.attrs?.annotationId === "string" && node.attrs.annotationId) {
      ids.add(node.attrs.annotationId);
    }
    for (const child of node.content ?? []) walk(child);
  }
  walk(doc);
  return [...ids];
}

/** Comment thread ids whose anchor mark is still present in the document. */
export function extractCommentAnchors(doc: TiptapNode | null | undefined): string[] {
  if (!doc) return [];
  const ids = new Set<string>();
  function walk(node: TiptapNode) {
    for (const mark of node.marks ?? []) {
      if (mark.type === "comment") {
        if (typeof mark.attrs?.threadId === "string") ids.add(mark.attrs.threadId);
        if (Array.isArray(mark.attrs?.threadIds)) for (const id of mark.attrs.threadIds) if (typeof id === "string") ids.add(id);
      }
    }
    for (const child of node.content ?? []) walk(child);
  }
  walk(doc);
  return [...ids];
}

/** Stable commentable media node ids still present in the document. */
export function extractCommentNodeIds(doc: TiptapNode | null | undefined): string[] {
  if (!doc) return [];
  const ids = new Set<string>();
  function walk(node: TiptapNode) {
    if ((node.type === "commentableImage" || node.type === "pdfEvidence") && typeof node.attrs?.nodeId === "string" && node.attrs.nodeId) ids.add(node.attrs.nodeId);
    for (const child of node.content ?? []) walk(child);
  }
  walk(doc);
  return [...ids];
}

/** Attachment ids that must not be deleted while an inline image node references them. */
export function extractEmbeddedAttachmentIds(doc: TiptapNode | null | undefined): string[] {
  if (!doc) return [];
  const ids = new Set<string>();
  function walk(node: TiptapNode) {
    if (node.type === "commentableImage" && typeof node.attrs?.attachmentId === "string" && node.attrs.attachmentId) ids.add(node.attrs.attachmentId);
    for (const child of node.content ?? []) walk(child);
  }
  walk(doc);
  return [...ids];
}

/** Creates a URL-safe slug from a title (umlauts transliterated). */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "seite"
  );
}

/** Builds a prefix-match FTS5 query from free-form user input. */
export function buildFtsQuery(input: string): string | null {
  const tokens = input
    .replace(/["'*]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(" ");
}
