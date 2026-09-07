import { createHash } from "node:crypto";
import { documentSections, documentHeadingStructures, type DocumentHeadingStructure, withDocumentSectionIds } from "./document-sections";
import type { TiptapNode } from "./tiptap";

export type DocumentSubsection = { id: string; title: string; level: number; parentSectionId: string | null };

export type DocumentSourceSnapshot = {
  subsections?: DocumentSubsection[];
  subsectionsTruncated?: boolean;
  fingerprint: string;
  headingTitle?: string;
  headingStructure?: DocumentHeadingStructure;
  headingParentTitle?: string;
  text: string;
  truncated: boolean;
  imageCount: number;
};

// Heading boundaries work across lists and layout columns as well as at the root.
function blocks(node: TiptapNode): TiptapNode[] {
  const containsHeading = (item: TiptapNode): boolean => item.type === "heading" || Boolean(item.content?.some(containsHeading));
  if (node.type === "heading" || !containsHeading(node)) return [node];
  return (node.content ?? []).flatMap(blocks);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function semanticNode(node: TiptapNode): TiptapNode {
  const attrs = { ...node.attrs };
  // Navigation and comment identities do not change the source's meaning.
  if (node.type === "heading") { delete attrs.id; delete attrs.collapsed; }
  if (node.type === "commentableImage") delete attrs.nodeId;
  return { ...node, attrs, ...(node.content ? { content: node.content.map(semanticNode) } : {}) };
}
function previewText(node: TiptapNode): string {
  if (node.text) return node.text;
  if (node.type === "hardBreak") return "\n";
  if (node.type === "commentableImage") return String(node.attrs?.alt ?? "");
  const inline = ["paragraph", "heading", "text"].includes(node.type ?? "");
  return (node.content ?? []).map(previewText).join(inline ? "" : "\n");
}

/** Prepare once per document, then resolve only requested sections. Hash the full
 * section (including descendants), independently of the bounded text preview. */
export function documentSourceSnapshots(doc: TiptapNode) {
  const structures = documentHeadingStructures(doc);
  const titles = new Map(documentSections(doc).map((s) => [s.id, s.title]));
  const content = blocks(withDocumentSectionIds(doc));
  const indices = new Map(content.flatMap((node, index) => node.type === "heading" ? [[String(node.attrs?.id), index] as const] : []));
  return (sectionId: string): DocumentSourceSnapshot | null => {
    const start = sectionId ? indices.get(sectionId) : 0;
    if (start === undefined) return null;
    let end = content.length;
    if (sectionId) {
      const level = Number(content[start].attrs?.level) || 1;
      for (let i = start + 1; i < content.length; i++) {
        if (content[i].type === "heading" && (Number(content[i].attrs?.level) || 1) <= level) { end = i; break; }
      }
    }
    const section = content.slice(start, end);
    const text = section.map(previewText).join("\n\n").trim();
    let imageCount = 0;
    const count = (node: TiptapNode) => { if (node.type === "commentableImage") imageCount++; node.content?.forEach(count); };
    section.forEach(count);
    const subsections = section.flatMap((node): DocumentSubsection[] => {
      const id = String(node.attrs?.id ?? "");
      const structure = structures.get(id);
      return node.type === "heading" && id !== sectionId && structure ? [{ id, title: titles.get(id)?.slice(0, 200) ?? "", ...structure }] : [];
    });
    return {
      subsections: subsections.slice(0, 500), subsectionsTruncated: subsections.length > 500,
      ...(sectionId ? { headingTitle: previewText(content[start]).trim().replace(/\s+/g, " ").slice(0, 200) } : {}),
      ...(sectionId && structures.has(sectionId) ? { headingStructure: structures.get(sectionId)!, headingParentTitle: titles.get(structures.get(sectionId)!.parentSectionId ?? "") } : {}),
      fingerprint: createHash("sha256").update(JSON.stringify(canonical(section.map(semanticNode)))).digest("hex"),
      text: text.slice(0, 2000), truncated: text.length > 2000, imageCount,
    };
  };
}
