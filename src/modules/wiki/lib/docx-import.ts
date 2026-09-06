import { DOMParser, type Node as HtmlNode, type Element } from "@xmldom/xmldom";
import type { TiptapNode } from "./tiptap";

const children = (node: HtmlNode): HtmlNode[] => Array.from(node.childNodes ?? []);
const tag = (node: HtmlNode) => node.nodeName.toLowerCase();

function inline(node: HtmlNode, marks: NonNullable<TiptapNode["marks"]> = []): TiptapNode[] {
  if (node.nodeType === 3) return node.nodeValue ? [{ type: "text", text: node.nodeValue, ...(marks.length ? { marks } : {}) }] : [];
  if (tag(node) === "br") return [{ type: "hardBreak" }];
  const mark = ({ strong: "bold", b: "bold", em: "italic", i: "italic", u: "underline", s: "strike", sup: "superscript", sub: "subscript" } as Record<string, string>)[tag(node)];
  let nextMarks = mark ? [...marks, { type: mark }] : marks;
  if (tag(node) === "a") {
    const href = (node as Element).getAttribute("href") ?? "";
    if (/^(https?:\/\/|mailto:|\/wiki\/|#)/i.test(href)) nextMarks = [...marks, { type: "link", attrs: { href } }];
  }
  return children(node).flatMap((child) => inline(child, nextMarks));
}

export function docxHtmlToTiptap(html: string): TiptapNode {
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").documentElement!;
  const headingIds = new Set<string>();
  function blocks(node: HtmlNode): TiptapNode[] {
    const name = tag(node);
    if (/^h[1-6]$/.test(name)) {
      const base = (node.textContent ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "heading";
      let id = base;
      for (let index = 2; headingIds.has(id); index++) id = `${base}-${index}`;
      headingIds.add(id);
      return [{ type: "heading", attrs: { level: Number(name[1]), id }, content: inline(node) }];
    }
    if (name === "p") return [{ type: "paragraph", content: inline(node) }];
    if (name === "ul" || name === "ol") {
      return [{ type: name === "ul" ? "bulletList" : "orderedList", ...(name === "ol" ? { attrs: { start: Number((node as Element).getAttribute("start")) || 1 } } : {}), content: children(node).filter((item) => tag(item) === "li").map((item) => {
        const content: TiptapNode[] = [];
        let run: TiptapNode[] = [];
        const flush = () => { if (run.length) content.push({ type: "paragraph", content: run }); run = []; };
        for (const child of children(item)) {
          if (["p", "ul", "ol"].includes(tag(child))) { flush(); content.push(...blocks(child)); }
          else run.push(...inline(child));
        }
        flush();
        if (content[0]?.type !== "paragraph") content.unshift({ type: "paragraph" });
        return { type: "listItem", content };
      }) }];
    }
    if (name === "table") {
      const rows = children(node).flatMap((child) => tag(child) === "tr" ? [child] : children(child).filter((row) => tag(row) === "tr"));
      return [{ type: "markdownTable", attrs: { tableId: `imported-${crypto.randomUUID()}`, caption: "", includeInTableIndex: true }, content: rows.map((row) => ({
        type: "markdownTableRow", content: children(row).filter((cell) => ["td", "th"].includes(tag(cell))).map((cell) => ({
          type: tag(cell) === "th" ? "markdownTableHeader" : "markdownTableCell",
          attrs: { alignment: "left", widthPercent: null },
          content: children(cell).some((child) => tag(child) === "p") ? children(cell).flatMap(blocks) : [{ type: "paragraph", content: inline(cell) }],
        })),
      })) }];
    }
    return children(node).flatMap(blocks);
  }
  const content = children(root).flatMap(blocks);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
