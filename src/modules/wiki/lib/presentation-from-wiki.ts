import type { PresentationElement, PresentationFrameElement, PresentationStep } from "./presentation";
import { parseStoredDocument, type TiptapNode } from "./tiptap";
import { withDocumentSectionIds } from "./document-sections";
import { documentSourceSnapshots } from "./document-source-snapshot";
import type { PresentationSource } from "./presentation-source";

/**
 * Turns a wiki page's heading outline into a starting presentation canvas: each heading
 * becomes a frame, nested under its parent heading's frame the way the outline nests, and
 * embedded images ride along inside the frame of the heading they appear under. No prose
 * is copied in — only the outline shapes the canvas, which is what a Prezi-style zoom path
 * is for. Kept dependency-free from React/DB so it runs in unit tests as plain data in/out.
 */

export type WikiPresentationSourcePage = {
  id?: string;
  title: string;
  contentJson: string;
};

export type PresentationFromWikiOptions = {
  /** Off skips embedded images entirely, leaving pure heading frames. Default true. */
  includeImages?: boolean;
};

type Section = {
  source?: PresentationSource;
  title: string;
  images: Array<{ attachmentId: string; alt: string }>;
  children: Section[];
};

type SizedSection = Section & { width: number; height: number; children: SizedSection[] };

// A childless heading (or an embedded image) occupies this much canvas space.
const LEAF_WIDTH = 360;
const LEAF_HEIGHT = 220;
// Gap inside a frame around its children, and between sibling top-level frames.
const GAP = 60;
// Size of the fallback single frame when the page has no headings at all.
const FALLBACK_WIDTH = 900;
const FALLBACK_HEIGHT = 500;

function nodeText(node: TiptapNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(nodeText).join("");
}

function collectImages(node: TiptapNode, out: Array<{ attachmentId: string; alt: string }>) {
  if (node.type === "commentableImage") {
    const attachmentId = String(node.attrs?.attachmentId ?? "").trim();
    // Markdown-imported images can carry an empty attachmentId until someone re-uploads
    // them, and the presentation image element requires a real one — skip those.
    if (attachmentId) out.push({ attachmentId, alt: String(node.attrs?.alt ?? "").trim() });
  }
  for (const child of node.content ?? []) collectImages(child, out);
}

/** Walk structural wrappers too, including headings inside lists and columns. */
function* outlineNodes(node: TiptapNode): Generator<TiptapNode> {
  if (node.type === "heading" || node.type === "commentableImage") yield node;
  else for (const child of node.content ?? []) yield* outlineNodes(child);
}

/** Builds the heading tree in document order, nesting by heading level. */
function buildOutline(doc: TiptapNode, pageId?: string): Section[] {
  const roots: Section[] = [];
  const stack: Array<{ level: number; section: Section }> = [];

  for (const node of outlineNodes(doc)) {
    if (node.type === "heading") {
      const level = Number(node.attrs?.level) || 1;
      const title = nodeText(node).trim().replace(/\s+/g, " ");
      if (!title) continue;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const section: Section = { title, images: [], children: [], ...(pageId ? { source: { pageId, sectionId: String(node.attrs?.id) } } : {}) };
      const parent = stack[stack.length - 1]?.section;
      if (parent) parent.children.push(section);
      else roots.push(section);
      stack.push({ level, section });
      continue;
    }
    // Images before the first heading have no section to attach to and are dropped.
    // ponytail: no synthetic "intro" frame for pre-heading content, add one if that
    // content turns out to matter in practice.
    const current = stack[stack.length - 1]?.section;
    if (current) collectImages(node, current.images);
  }
  return roots;
}

function measure(section: Section): SizedSection {
  const children = section.children.map(measure);
  const boxes = [
    ...children.map((child) => ({ width: child.width, height: child.height })),
    ...section.images.map(() => ({ width: LEAF_WIDTH, height: LEAF_HEIGHT })),
  ];
  if (!boxes.length) return { ...section, children, width: LEAF_WIDTH, height: LEAF_HEIGHT };
  const width = boxes.reduce((sum, box) => sum + box.width, 0) + GAP * (boxes.length + 1);
  const height = Math.max(...boxes.map((box) => box.height)) + GAP * 2;
  return { ...section, children, width, height };
}

function frameElement(id: string, x: number, y: number, width: number, height: number, label: string): PresentationFrameElement {
  return {
    id,
    type: "frame",
    x,
    y,
    width,
    height,
    rotation: 0,
    content: { label: label.slice(0, 200), shape: "rect", color: "" },
  };
}

/** Places a sized section's frame and (in document order) its children and images inside it. */
function place(
  section: SizedSection,
  x: number,
  y: number,
  elements: PresentationElement[],
  steps: PresentationStep[],
  nextId: () => string,
  parentId?: string,
) {
  const id = nextId();
  elements.push({ ...frameElement(id, x, y, section.width, section.height, section.title), parentId, ...(section.source ? { source: section.source } : {}) });
  steps.push({ id: nextId(), elementId: id });

  let cursorX = x + GAP;
  const rowY = y + GAP;
  for (const child of section.children) {
    place(child, cursorX, rowY, elements, steps, nextId, id);
    cursorX += child.width + GAP;
  }
  for (const image of section.images) {
    elements.push({
      id: nextId(),
      type: "image",
      parentId: id,
      x: cursorX,
      y: rowY,
      width: LEAF_WIDTH,
      height: LEAF_HEIGHT,
      rotation: 0,
      content: { attachmentId: image.attachmentId, alt: image.alt },
    });
    cursorX += LEAF_WIDTH + GAP;
  }
}

export function presentationFromWikiPage(
  page: WikiPresentationSourcePage,
  options: PresentationFromWikiOptions = {},
): { elements: PresentationElement[]; steps: PresentationStep[] } {
  const includeImages = options.includeImages ?? true;
  const doc = withDocumentSectionIds(parseStoredDocument(page.contentJson));
  const outline = buildOutline(doc, page.id);
  const snapshot = documentSourceSnapshots(doc);
  for (const section of walkSections(outline)) if (section.source) section.source.reviewedFingerprint = snapshot(section.source.sectionId)?.fingerprint;
  if (!includeImages) for (const section of walkSections(outline)) section.images = [];

  if (!outline.length) {
    const id = "id-1";
    return {
      elements: [{ ...frameElement(id, 0, 0, FALLBACK_WIDTH, FALLBACK_HEIGHT, page.title), ...(page.id ? { source: { pageId: page.id, sectionId: "", reviewedFingerprint: snapshot("")!.fingerprint } } : {}) }],
      steps: [{ id: "id-2", elementId: id }],
    };
  }

  const sized = outline.map(measure);
  const elements: PresentationElement[] = [];
  const steps: PresentationStep[] = [];
  let counter = 0;
  const nextId = () => `id-${++counter}`;

  let cursorX = 0;
  for (const root of sized) {
    place(root, cursorX, 0, elements, steps, nextId);
    cursorX += root.width + GAP;
  }
  return { elements, steps };
}

function walkSections(sections: Section[]): Section[] {
  return sections.flatMap((section) => [section, ...walkSections(section.children)]);
}
