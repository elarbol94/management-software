import type { Node as PMNode } from "@tiptap/pm/model";
import { isFigure, removeFigureNumberPrefix } from "./figure";

/** Keep the mapped original's identity when a duplicate is pasted before it. */
export function figureRepairs(doc: PMNode, originalPositions = new Map<string, number>()) {
  const entries: Array<{ node: PMNode; position: number }> = [];
  doc.descendants((node, position) => { if (isFigure(node.type.name)) entries.push({ node, position }); });
  const owner = new Map<string, number>();
  for (const { node, position } of entries) {
    const id = String(node.attrs.nodeId || "");
    if (id && (!owner.has(id) || originalPositions.get(id) === position)) owner.set(id, position);
  }
  return entries.flatMap(({ node, position }) => {
    const attrs = { ...node.attrs };
    const id = String(attrs.nodeId || "");
    if (!id || owner.get(id) !== position) attrs.nodeId = crypto.randomUUID();
    attrs.caption = removeFigureNumberPrefix(String(attrs.caption || ""));
    return attrs.nodeId !== node.attrs.nodeId || attrs.caption !== node.attrs.caption ? [{ position, attrs }] : [];
  });
}
