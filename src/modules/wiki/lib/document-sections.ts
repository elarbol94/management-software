import type { TiptapNode } from "./tiptap";

export type DocumentSection = { id: string; title: string; level: number };

/** Legacy headings get the same initial identity in readers and the editor. Once
 * saved, that identity travels with the heading, independently of its label/order. */
export function withDocumentSectionIds(doc: TiptapNode): TiptapNode {
  const reserved = new Set<string>();
  const visit = (node: TiptapNode) => {
    if (node.type === "heading" && node.attrs?.id) reserved.add(String(node.attrs.id).trim());
    node.content?.forEach(visit);
  };
  visit(doc);
  const seen = new Set<string>();
  let counter = 0;
  const normalize = (node: TiptapNode): TiptapNode => {
    let next = node;
    if (node.type === "heading") {
      let id = String(node.attrs?.id ?? "").trim();
      if (!id || seen.has(id)) {
        do { id = `section-legacy-${++counter}`; } while (reserved.has(id));
        reserved.add(id);
        next = { ...node, attrs: { ...node.attrs, id } };
      }
      if (id !== next.attrs?.id) next = { ...next, attrs: { ...next.attrs, id } };
      seen.add(id);
    }
    if (next.content) {
      const content = next.content.map(normalize);
      if (content.some((child, index) => child !== next.content![index])) next = { ...next, content };
    }
    return next;
  };
  return normalize(doc);
}

export function documentSections(doc: TiptapNode): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const text = (node: TiptapNode): string => node.text ?? (node.content ?? []).map(text).join("");
  const visit = (node: TiptapNode) => {
    if (node.type === "heading") sections.push({ id: String(node.attrs?.id), title: text(node).trim(), level: Number(node.attrs?.level) || 1 });
    node.content?.forEach(visit);
  };
  visit(withDocumentSectionIds(doc));
  return sections;
}

export type DocumentHeadingStructure = { level: number; parentSectionId: string | null };

/** Match the generator's stack, including skipped levels and empty headings. */
export function documentHeadingStructures(doc: TiptapNode): Map<string, DocumentHeadingStructure> {
  const result = new Map<string, DocumentHeadingStructure>();
  const stack: DocumentSection[] = [];
  for (const section of documentSections(doc)) {
    if (!section.title) continue;
    while (stack.length && stack[stack.length - 1].level >= section.level) stack.pop();
    result.set(section.id, { level: section.level, parentSectionId: stack.at(-1)?.id ?? null });
    stack.push(section);
  }
  return result;
}
