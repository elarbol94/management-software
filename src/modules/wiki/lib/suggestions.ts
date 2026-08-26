import { parseStoredDocument, type TiptapNode } from "./tiptap";

export const SUGGESTION_INSERT = "suggestionInsert";
export const SUGGESTION_DELETE = "suggestionDelete";

export type SuggestionCounts = { inserted: number; deleted: number };

function marksOf(node: TiptapNode): Array<{ type?: string }> {
  return Array.isArray(node.marks) ? (node.marks as Array<{ type?: string }>) : [];
}

function hasMark(node: TiptapNode, name: string) {
  return marksOf(node).some((mark) => mark.type === name);
}

function withoutMark(node: TiptapNode, name: string): TiptapNode {
  const kept = marksOf(node).filter((mark) => mark.type !== name);
  if (kept.length === marksOf(node).length) return node;
  const next = { ...node } as TiptapNode & { marks?: unknown };
  if (kept.length) next.marks = kept;
  else delete next.marks;
  return next;
}

/**
 * Resolves suggestions in a document.
 *
 * Accepting keeps inserted text and drops deleted text; rejecting does the opposite.
 * Both work on the stored JSON rather than on editor state, so the same function
 * serves the accept-all command, the export pipeline, and its own tests.
 */
function resolve(node: TiptapNode, dropMark: string, keepMark: string): TiptapNode | null {
  if (hasMark(node, dropMark)) return null;
  const cleaned = withoutMark(withoutMark(node, keepMark), dropMark);
  if (!Array.isArray(cleaned.content)) return cleaned;
  const content = cleaned.content
    .map((child) => resolve(child, dropMark, keepMark))
    .filter((child): child is TiptapNode => child !== null);
  return { ...cleaned, content };
}

/** Keeps insertions, removes deletions. This is what an export should render. */
export function acceptSuggestions(doc: TiptapNode): TiptapNode {
  return resolve(doc, SUGGESTION_DELETE, SUGGESTION_INSERT) ?? doc;
}

/** Removes insertions, restores deletions. */
export function rejectSuggestions(doc: TiptapNode): TiptapNode {
  return resolve(doc, SUGGESTION_INSERT, SUGGESTION_DELETE) ?? doc;
}

/** How many text runs are pending, so the UI can show whether a document has open edits. */
export function countSuggestions(node: TiptapNode, counts: SuggestionCounts = { inserted: 0, deleted: 0 }): SuggestionCounts {
  if (hasMark(node, SUGGESTION_INSERT)) counts.inserted += 1;
  if (hasMark(node, SUGGESTION_DELETE)) counts.deleted += 1;
  if (Array.isArray(node.content)) for (const child of node.content) countSuggestions(child, counts);
  return counts;
}

export function hasSuggestions(doc: TiptapNode) {
  const counts = countSuggestions(doc);
  return counts.inserted + counts.deleted > 0;
}

/**
 * The document as it would read once every open suggestion is accepted.
 *
 * Exports and templates use this rather than the raw stored document: a PDF sent to a
 * client must not carry someone's pending edit marks, and the pending state belongs to
 * the editor, not to the deliverable.
 */
export function parseDocumentForExport(contentJson: string): TiptapNode {
  return acceptSuggestions(parseStoredDocument(contentJson));
}
