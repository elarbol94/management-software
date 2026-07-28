import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type ProofingLanguage = "de-DE" | "en-US";
export type SpellcheckIssueKind = "spelling" | "writing";

export type SpellcheckIssue = {
  from: number;
  to: number;
  message: string;
  kind: SpellcheckIssueKind;
  category: string;
  ruleId: string;
  replacements: string[];
};

export type SpellcheckResponseMatch = {
  paragraph: number;
  offset: number;
  length: number;
  message: string;
  kind: SpellcheckIssueKind;
  category: string;
  ruleId: string;
  replacements: string[];
};

export type SpellcheckParagraph = { text: string; from: number; excludedRanges: Array<{ from: number; to: number }> };
export type SpellcheckBatchItem = { text: string; paragraph: number; offset: number };
export type SpellcheckBatch = { items: SpellcheckBatchItem[] };

export const SPELLCHECK_BATCH_MAX_PARAGRAPHS = 80;
export const SPELLCHECK_BATCH_MAX_CHARACTERS = 24_000;
const SPELLCHECK_SEGMENT_MAX_CHARACTERS = 12_000;

function splitParagraphForProofing(text: string, paragraph: number): SpellcheckBatchItem[] {
  const items: SpellcheckBatchItem[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + SPELLCHECK_SEGMENT_MAX_CHARACTERS, text.length);
    if (end < text.length) {
      const whitespace = text.lastIndexOf(" ", end);
      if (whitespace > offset + SPELLCHECK_SEGMENT_MAX_CHARACTERS / 2) end = whitespace + 1;
    }
    items.push({ text: text.slice(offset, end), paragraph, offset });
    offset = end;
  }
  return items;
}

export function createSpellcheckBatches(paragraphs: SpellcheckParagraph[]): SpellcheckBatch[] {
  const batches: SpellcheckBatch[] = [];
  let items: SpellcheckBatchItem[] = [];
  let characters = 0;
  for (const item of paragraphs.flatMap((paragraph, index) => splitParagraphForProofing(paragraph.text, index))) {
    if (items.length && (items.length >= SPELLCHECK_BATCH_MAX_PARAGRAPHS || characters + item.text.length > SPELLCHECK_BATCH_MAX_CHARACTERS)) {
      batches.push({ items });
      items = [];
      characters = 0;
    }
    items.push(item);
    characters += item.text.length;
  }
  if (items.length) batches.push({ items });
  return batches;
}

export function remapSpellcheckBatchMatches(batch: SpellcheckBatch, matches: SpellcheckResponseMatch[]): SpellcheckResponseMatch[] {
  return matches.flatMap((match) => {
    const item = batch.items[match.paragraph];
    return item ? [{ ...match, paragraph: item.paragraph, offset: item.offset + match.offset }] : [];
  });
}

export const spellcheckKey = new PluginKey<SpellcheckIssue[]>("wikiSpellcheck");

/** Returns independently checkable prose blocks and their document offsets. */
export function collectSpellcheckParagraphs(doc: ProseMirrorNode): SpellcheckParagraph[] {
  const paragraphs: SpellcheckParagraph[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock || node.type.name === "codeBlock" || node.isAtom) return;
    const text = node.textContent.trim();
    if (text.length < 2 || /^(https?:\/\/|www\.)/i.test(text)) return;
    const leadingWhitespace = node.textContent.length - node.textContent.trimStart().length;
    const excludedRanges: Array<{ from: number; to: number }> = [];
    node.descendants((child, offset) => {
      if (!child.isText || !child.text) return;
      const excluded = child.marks.some((mark) => mark.type.name === "code" || mark.type.name === "link");
      if (excluded) excludedRanges.push({ from: Math.max(0, offset - leadingWhitespace), to: Math.max(0, offset - leadingWhitespace + child.text.length) });
    });
    paragraphs.push({ text, from: position + 1 + leadingWhitespace, excludedRanges });
  });
  return paragraphs;
}

function shouldIgnoreMatch(paragraph: SpellcheckParagraph, offset: number, length: number) {
  const end = offset + length;
  if (paragraph.excludedRanges.some((range) => range.from < end && offset < range.to)) return true;
  const before = paragraph.text.slice(0, offset).match(/[^\s()[\]{}<>]+$/)?.[0] ?? "";
  const after = paragraph.text.slice(end).match(/^[^\s()[\]{}<>]+/)?.[0] ?? "";
  const token = `${before}${paragraph.text.slice(offset, end)}${after}`.replace(/^["\x27„“‚‘,;:!?]+|["\x27”’.,;:!?]+$/g, "");
  return /^(?:https?:\/\/|www\.)/i.test(token)
    || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token)
    || /^[\p{L}\p{N}_-]+\.[a-z0-9]{1,8}$/iu.test(token)
    || /^[A-ZÄÖÜ0-9][A-ZÄÖÜ0-9_-]{1,}$/.test(token)
    || /^\d+(?:[.,:\/-]\d+)*$/.test(token);
}

export function mapSpellcheckMatches(
  paragraphs: SpellcheckParagraph[],
  matches: SpellcheckResponseMatch[],
): SpellcheckIssue[] {
  return matches.flatMap((match) => {
    const paragraph = paragraphs[match.paragraph];
    if (!paragraph || match.offset < 0 || match.length < 1 || match.offset + match.length > paragraph.text.length || shouldIgnoreMatch(paragraph, match.offset, match.length)) return [];
    return [{
      from: paragraph.from + match.offset,
      to: paragraph.from + match.offset + match.length,
      message: match.message,
      kind: match.kind,
      category: match.category,
      ruleId: match.ruleId,
      replacements: match.replacements,
    }];
  });
}

export function getSpellcheckIssues(editor: Editor) {
  return spellcheckKey.getState(editor.state) ?? [];
}

export function replaceAllSpellcheckOccurrences(editor: Editor, source: string, replacement: string) {
  if (!source || source === replacement) return 0;
  const ranges: Array<{ from: number; to: number }> = [];
  editor.state.doc.descendants((node, position, parent) => {
    if (!node.isText || !node.text || parent?.type.name === "codeBlock" || node.marks.some((mark) => mark.type.name === "code" || mark.type.name === "link")) return;
    let offset = node.text.indexOf(source);
    while (offset >= 0) {
      ranges.push({ from: position + offset, to: position + offset + source.length });
      offset = node.text.indexOf(source, offset + source.length);
    }
  });
  if (!ranges.length) return 0;
  const transaction = editor.state.tr;
  for (const range of ranges.reverse()) transaction.insertText(replacement, range.from, range.to);
  editor.view.dispatch(transaction);
  return ranges.length;
}


export function setSpellcheckIssues(editor: Editor, issues: SpellcheckIssue[]) {
  editor.view.dispatch(editor.view.state.tr.setMeta(spellcheckKey, issues));
}

export function createSpellcheckExtension(onIssueClick: (issue: SpellcheckIssue, target: HTMLElement) => void) {
  return Extension.create({
    name: "wikiSpellcheck",
    addProseMirrorPlugins() {
      return [new Plugin<SpellcheckIssue[]>({
        key: spellcheckKey,
        state: {
          init: () => [],
          apply(transaction, issues) {
            const replacement = transaction.getMeta(spellcheckKey) as SpellcheckIssue[] | undefined;
            return replacement ?? issues.map((issue) => ({
              ...issue,
              from: transaction.mapping.map(issue.from),
              to: transaction.mapping.map(issue.to, -1),
            })).filter((issue) => issue.from < issue.to);
          },
        },
        props: {
          decorations(state) {
            const issues = spellcheckKey.getState(state) ?? [];
            return DecorationSet.create(state.doc, issues.map((issue) => Decoration.inline(issue.from, issue.to, {
              class: "wiki-spellcheck-issue wiki-spellcheck-issue--" + issue.kind,
              "data-spellcheck-issue": "true",
              title: issue.message,
            })));
          },
          handleClick(view, _position, event) {
            const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-spellcheck-issue]") : null;
            if (!target) return false;
            const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const issue = (spellcheckKey.getState(view.state) ?? []).find((candidate) => coordinates?.pos != null && candidate.from <= coordinates.pos && candidate.to >= coordinates.pos);
            if (!issue) return false;
            onIssueClick(issue, target);
            return true;
          },
        },
      })];
    },
  });
}
