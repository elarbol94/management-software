import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type ProofingLanguage = "de-DE" | "de-AT" | "en-US";
export type SpellcheckIssueKind = "spelling" | "writing";

/** Cycle order for the proofing-language switcher; de-DE stays first so it keeps being the "primary" toggle target. */
export const PROOFING_LANGUAGES: ProofingLanguage[] = ["de-DE", "en-US", "de-AT"];

export function nextProofingLanguage(current: ProofingLanguage): ProofingLanguage {
  const index = PROOFING_LANGUAGES.indexOf(current);
  return PROOFING_LANGUAGES[(index + 1) % PROOFING_LANGUAGES.length];
}

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

type SpellcheckState = { issues: SpellcheckIssue[]; decorations: DecorationSet };
export const spellcheckKey = new PluginKey<SpellcheckState>("wikiSpellcheck");

/** Returns independently checkable prose blocks and their document offsets. */
export function collectSpellcheckParagraphs(doc: ProseMirrorNode): SpellcheckParagraph[] {
  const paragraphs: SpellcheckParagraph[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === "codeBlock" || node.isAtom) return false;
    if (!node.isTextblock) return;
    // Inline atoms and hard breaks occupy document positions too. Keep one
    // character per position so a suggestion can never shift onto nearby text.
    let rawText = "";
    const excludedRanges: Array<{ from: number; to: number }> = [];
    node.forEach((child, offset) => {
      rawText += child.isText ? child.text! : child.type.name === "hardBreak" ? "\n" : " ".repeat(child.nodeSize);
      if (!child.isText || child.marks.some((mark) => ["code", "link", "suggestionDelete"].includes(mark.type.name))) {
        excludedRanges.push({ from: offset, to: offset + child.nodeSize });
      }
    });
    const text = rawText.trim();
    if (text.length < 2 || /^(https?:\/\/|www\.)\S+$/i.test(text)) return false;
    const leadingWhitespace = rawText.length - rawText.trimStart().length;
    paragraphs.push({ text, from: position + 1 + leadingWhitespace, excludedRanges: excludedRanges
      .map((range) => ({ from: Math.max(0, range.from - leadingWhitespace), to: Math.min(text.length, range.to - leadingWhitespace) }))
      .filter((range) => range.to > range.from) });
    return false;
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
    if (!paragraph || !Number.isInteger(match.offset) || !Number.isInteger(match.length) || match.offset < 0 || match.length < 1 || match.offset + match.length > paragraph.text.length || shouldIgnoreMatch(paragraph, match.offset, match.length)) return [];
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
  return spellcheckKey.getState(editor.state)?.issues ?? [];
}

export function replaceAllSpellcheckOccurrences(editor: Editor, issue: SpellcheckIssue, replacement: string) {
  if (!editor.isEditable || !getSpellcheckIssues(editor).includes(issue)) return 0;
  const source = editor.state.doc.textBetween(issue.from, issue.to);
  if (!source || source === replacement) return 0;
  // Grammar depends on context. Only replace occurrences the checker actually
  // marked with this rule, never arbitrary substrings elsewhere in the document.
  const ranges = getSpellcheckIssues(editor).filter((candidate) => candidate.ruleId === issue.ruleId
    && candidate.kind === issue.kind && editor.state.doc.textBetween(candidate.from, candidate.to) === source);
  if (!ranges.length) return 0;
  const transaction = editor.state.tr;
  for (const range of ranges.reverse()) transaction.insertText(replacement, range.from, range.to);
  editor.view.dispatch(transaction);
  return ranges.length;
}


export function setSpellcheckIssues(editor: Editor, issues: SpellcheckIssue[]) {
  editor.view.dispatch(editor.view.state.tr.setMeta(spellcheckKey, issues));
}

export function createSpellcheckPlugin(onIssueClick: (issue: SpellcheckIssue, target: HTMLElement) => void) {
  const decorate = (doc: ProseMirrorNode, issues: SpellcheckIssue[]) => DecorationSet.create(doc, issues.map((issue) => Decoration.inline(issue.from, issue.to, {
    class: "wiki-spellcheck-issue wiki-spellcheck-issue--" + issue.kind,
    "data-spellcheck-issue": "true",
    title: issue.message,
  })));
  return new Plugin<SpellcheckState>({
    key: spellcheckKey,
    state: {
      init: () => ({ issues: [], decorations: DecorationSet.empty }),
      apply(transaction, previous) {
        const replacement = transaction.getMeta(spellcheckKey) as SpellcheckIssue[] | undefined;
        if (replacement) return { issues: replacement, decorations: decorate(transaction.doc, replacement) };
        if (!transaction.docChanged) return previous;
        let issues = previous.issues;
        transaction.mapping.maps.forEach((map, index) => {
          issues = issues.flatMap((issue) => {
            const start = transaction.docs[index].resolve(issue.from);
            let touched = false;
            map.forEach((from, to) => {
              if (from <= start.end() && to >= start.start()) touched = true;
            });
            if (touched) return [];
            const from = map.map(issue.from), to = map.map(issue.to, -1);
            return from < to ? [{ ...issue, from, to }] : [];
          });
        });
        return { issues, decorations: decorate(transaction.doc, issues) };
      },
    },
    props: {
      decorations(state) {
        return spellcheckKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
      handleClick(view, _position, event) {
        const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-spellcheck-issue]") : null;
        if (!target) return false;
        const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
        const issue = (spellcheckKey.getState(view.state)?.issues ?? []).find((candidate) => coordinates?.pos != null && candidate.from <= coordinates.pos && candidate.to >= coordinates.pos);
        if (!issue) return false;
        onIssueClick(issue, target);
        return true;
      },
      handleKeyDown(view, event) {
        if (!event.altKey || !["F7", "Enter"].includes(event.key)) return false;
        const issues = spellcheckKey.getState(view.state)?.issues ?? [];
        const cursor = view.state.selection.from;
        const issue = event.key === "F7" ? issues.find((item) => item.from > cursor) ?? issues[0]
          : issues.find((item) => item.from <= cursor && cursor <= item.to);
        if (!issue) return false;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, issue.from, issue.to)).scrollIntoView());
        const dom = view.domAtPos(Math.min(issue.from + 1, issue.to)).node;
        const target = (dom instanceof HTMLElement ? dom : dom.parentElement)?.closest<HTMLElement>("[data-spellcheck-issue]")
          ?? view.nodeDOM(issue.from)?.parentElement?.querySelector<HTMLElement>("[data-spellcheck-issue]");
        if (!target) return false;
        onIssueClick(issue, target);
        return true;
      },
    },
  });
}

export function createSpellcheckExtension(onIssueClick: (issue: SpellcheckIssue, target: HTMLElement) => void) {
  return Extension.create({
    name: "wikiSpellcheck",
    addProseMirrorPlugins() {
      return [createSpellcheckPlugin(onIssueClick)];
    },
  });
}
