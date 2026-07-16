// Pure helpers for walking Tiptap JSON documents (no Tiptap dependency, so
// they run server-side and in unit tests without an editor instance).

export type TiptapNode = {
  type?: string;
  text?: string;
  content?: TiptapNode[];
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
};

/** Extracts plain text for the FTS index. Blocks are joined with newlines. */
export function extractText(doc: TiptapNode | null | undefined): string {
  if (!doc) return "";
  const blocks: string[] = [];

  function walkBlock(node: TiptapNode): string {
    if (node.text) return node.text;
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

/** Collects slugs of internal wiki links (hrefs of the form /wiki/<slug>). */
export function extractInternalSlugs(doc: TiptapNode | null | undefined): string[] {
  if (!doc) return [];
  const slugs = new Set<string>();

  function walk(node: TiptapNode) {
    for (const mark of node.marks ?? []) {
      if (mark.type === "link") {
        const href = String(mark.attrs?.href ?? "");
        const match = href.match(/^\/wiki\/([^/?#]+)$/);
        if (match) slugs.add(decodeURIComponent(match[1]));
      }
    }
    for (const child of node.content ?? []) walk(child);
  }

  walk(doc);
  return [...slugs];
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
