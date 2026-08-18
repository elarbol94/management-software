import type { TiptapNode } from "./tiptap";

function decode(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
}

function inline(value: string): TiptapNode[] {
  const content: TiptapNode[] = [];
  const normalized = value.replace(/<\/?p\b[^>]*>/gi, "");
  const pattern = /<(strong|b|em|i)\b[^>]*>([\s\S]*?)<\/\1>|([^<]+)/gi;
  for (const match of normalized.matchAll(pattern)) {
    const text = decode(match[2] ?? match[3] ?? "");
    if (!text) continue;
    const tag = (match[1] ?? "").toLowerCase();
    content.push({ type: "text", text, ...(tag ? { marks: [{ type: tag === "em" || tag === "i" ? "italic" : "bold" }] } : {}) });
  }
  return content.length ? content : (decode(value) ? [{ type: "text", text: decode(value) }] : []);
}

export function docxHtmlToTiptap(html: string): TiptapNode {
  const content: TiptapNode[] = [];
  const blocks = /<(h[1-3]|p|ul|ol|table)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(blocks)) {
    const tag = match[1].toLowerCase();
    const body = match[2];
    if (/^h[1-3]$/.test(tag)) {
      const label = decode(body);
      content.push({ type: "heading", attrs: { level: Number(tag[1]), id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || crypto.randomUUID() }, content: inline(body) });
    } else if (tag === "p") content.push({ type: "paragraph", content: inline(body) });
    else if (tag === "ul" || tag === "ol") {
      content.push({ type: tag === "ul" ? "bulletList" : "orderedList", content: [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((item) => ({ type: "listItem", content: [{ type: "paragraph", content: inline(item[1]) }] })) });
    } else if (tag === "table") {
      content.push({ type: "markdownTable", attrs: { tableId: `imported-${crypto.randomUUID()}`, caption: "", includeInTableIndex: true }, content: [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row, rowIndex) => ({ type: "markdownTableRow", content: [...row[1].matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((cell) => ({ type: rowIndex === 0 || cell[1].toLowerCase() === "th" ? "markdownTableHeader" : "markdownTableCell", attrs: { alignment: "left", widthPercent: null }, content: [{ type: "paragraph", content: inline(cell[2]) }] })) })) });
    }
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
