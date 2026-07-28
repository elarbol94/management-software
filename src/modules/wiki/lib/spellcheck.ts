import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type SpellcheckIssue = {
  from: number;
  to: number;
  message: string;
  replacements: string[];
};

export type SpellcheckResponseMatch = {
  paragraph: number;
  offset: number;
  length: number;
  message: string;
  replacements: string[];
};

export type SpellcheckParagraph = { text: string; from: number };

export const spellcheckKey = new PluginKey<SpellcheckIssue[]>("wikiSpellcheck");

/** Returns independently checkable prose blocks and their document offsets. */
export function collectSpellcheckParagraphs(doc: ProseMirrorNode): SpellcheckParagraph[] {
  const paragraphs: SpellcheckParagraph[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock || node.type.name === "codeBlock" || node.isAtom) return;
    const text = node.textContent.trim();
    if (text.length < 2 || /^(https?:\/\/|www\.)/i.test(text)) return;
    const leadingWhitespace = node.textContent.length - node.textContent.trimStart().length;
    paragraphs.push({ text, from: position + 1 + leadingWhitespace });
  });
  return paragraphs;
}

export function mapSpellcheckMatches(
  paragraphs: SpellcheckParagraph[],
  matches: SpellcheckResponseMatch[],
): SpellcheckIssue[] {
  return matches.flatMap((match) => {
    const paragraph = paragraphs[match.paragraph];
    if (!paragraph || match.offset < 0 || match.length < 1 || match.offset + match.length > paragraph.text.length) return [];
    return [{
      from: paragraph.from + match.offset,
      to: paragraph.from + match.offset + match.length,
      message: match.message,
      replacements: match.replacements.slice(0, 5),
    }];
  });
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
              class: "wiki-spellcheck-issue",
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
