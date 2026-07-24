import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type SearchOptions = { query: string; caseSensitive: boolean; wholeWord: boolean; current: number };
export type SearchMatch = { from: number; to: number };

export const editorSearchKey = new PluginKey<SearchOptions>("wikiEditorSearch");

export function findEditorMatches(doc: ProseMirrorNode, options: Omit<SearchOptions, "current">): SearchMatch[] {
  const query = options.caseSensitive ? options.query : options.query.toLocaleLowerCase();
  if (!query) return [];
  const matches: SearchMatch[] = [];
  doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    const source = options.caseSensitive ? node.text : node.text.toLocaleLowerCase();
    let index = 0;
    while ((index = source.indexOf(query, index)) >= 0) {
      const before = source[index - 1] ?? "";
      const after = source[index + query.length] ?? "";
      const wordBoundary = !options.wholeWord || (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after));
      if (wordBoundary) matches.push({ from: position + index, to: position + index + query.length });
      index += Math.max(query.length, 1);
    }
  });
  return matches;
}

export function setEditorSearch(editor: Editor, options: SearchOptions) {
  editor.view.dispatch(editor.state.tr.setMeta(editorSearchKey, options));
  const matches = findEditorMatches(editor.state.doc, options);
  if (matches.length) {
    const match = matches[Math.min(Math.max(options.current, 0), matches.length - 1)];
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, match.from, match.to)).scrollIntoView());
  }
  return matches;
}

export function replaceEditorMatches(editor: Editor, options: SearchOptions, replacement: string, all: boolean) {
  const matches = findEditorMatches(editor.state.doc, options);
  if (!matches.length) return 0;
  const targets = all ? [...matches].reverse() : [matches[Math.min(Math.max(options.current, 0), matches.length - 1)]];
  const transaction: Transaction = editor.state.tr;
  targets.forEach((match) => transaction.insertText(replacement, match.from, match.to));
  editor.view.dispatch(transaction);
  return targets.length;
}

export const EditorSearchExtension = Extension.create({
  name: "wikiEditorSearch",
  addProseMirrorPlugins() {
    return [new Plugin<SearchOptions>({
      key: editorSearchKey,
      state: {
        init: () => ({ query: "", caseSensitive: false, wholeWord: false, current: 0 }),
        apply(transaction, value) { return transaction.getMeta(editorSearchKey) ?? value; },
      },
      props: {
        decorations(state) {
          const options = editorSearchKey.getState(state);
          if (!options?.query) return DecorationSet.empty;
          const matches = findEditorMatches(state.doc, options);
          return DecorationSet.create(state.doc, matches.map((match, index) => Decoration.inline(match.from, match.to, {
            class: index === options.current ? "wiki-search-match wiki-search-match-current" : "wiki-search-match",
          })));
        },
      },
    })];
  },
});
