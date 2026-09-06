import type { TiptapNode } from "./tiptap";

/** Reject malformed documents before they can replace a valid saved page. */
export function parseEditorDocument(json: string): TiptapNode {
  const doc: unknown = JSON.parse(json);
  const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (!object(doc) || doc.type !== "doc" || !Array.isArray(doc.content)) throw new Error("Invalid document");
  const stack = [{ node: doc, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (depth > 100 || typeof node.type !== "string" || !node.type || (node.text !== undefined && typeof node.text !== "string")) throw new Error("Invalid document");
    if (node.attrs !== undefined && !object(node.attrs)) throw new Error("Invalid document attributes");
    if (node.marks !== undefined && (!Array.isArray(node.marks) || node.marks.some((mark) => !object(mark) || typeof mark.type !== "string"))) throw new Error("Invalid document marks");
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new Error("Invalid document children");
      for (const child of node.content) {
        if (!object(child)) throw new Error("Invalid document child");
        stack.push({ node: child, depth: depth + 1 });
      }
    }
  }
  return doc as TiptapNode;
}
