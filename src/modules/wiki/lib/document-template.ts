import type { TiptapNode } from "./tiptap";

/** Keep the outline and structure without retaining document-specific evidence. */
export function stripPageSpecificContent(doc: TiptapNode): TiptapNode {
  function clean(node: TiptapNode, preserveText = false): TiptapNode | null {
    if (["citation", "pdfEvidence", "commentableImage"].includes(node.type ?? "")) return null;
    const marks = node.marks?.filter((mark) => mark.type !== "comment");
    if (node.text !== undefined) return preserveText ? { ...node, marks } : null;
    const keepText = preserveText || node.type === "heading";
    const content = (node.content ?? []).map((child) => clean(child, keepText))
      .filter((child): child is TiptapNode => child !== null);
    // Always replace the children: spreading the original node when every child
    // was stripped used to silently reintroduce its original content.
    return { ...node, ...(marks ? { marks } : {}), ...(node.content ? { content } : {}) };
  }
  return clean(doc) ?? { type: "doc", content: [{ type: "paragraph" }] };
}
