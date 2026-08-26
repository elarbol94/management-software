import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { SUGGESTION_DELETE, SUGGESTION_INSERT } from "../lib/suggestions";

export type SuggestionOptions = { enabled: boolean; author: string };

const suggestionKey = new PluginKey("wikiSuggestions");

function suggestionMark(name: string, tag: string, className: string) {
  return Mark.create({
    name,
    inclusive: false,
    // Suggestions must survive other formatting being applied over them.
    excludes: "",
    addAttributes() {
      return {
        author: { default: "", parseHTML: (element) => element.getAttribute("data-author") ?? "" },
        at: { default: "", parseHTML: (element) => element.getAttribute("data-at") ?? "" },
      };
    },
    parseHTML() { return [{ tag: `${tag}[data-suggestion="${name}"]` }]; },
    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes, { "data-suggestion": name, class: className }), 0];
    },
  });
}

export const SuggestionInsert = suggestionMark(SUGGESTION_INSERT, "ins", "wiki-suggestion-insert");
export const SuggestionDelete = suggestionMark(SUGGESTION_DELETE, "del", "wiki-suggestion-delete");

/**
 * Track-changes without CRDT.
 *
 * Suggestion mode never removes text. Typing marks what was added, and deleting marks
 * what should go instead of taking it out, so the original stays readable until someone
 * accepts or rejects it. That is orthogonal to the page lease: it changes what an edit
 * *means*, not who is allowed to make one, so it needs no collaborative editing layer.
 */
export const SuggestionMode = Extension.create<SuggestionOptions>({
  name: "wikiSuggestionMode",

  addOptions() {
    return { enabled: false, author: "" };
  },

  addKeyboardShortcuts() {
    const markDeletion = (direction: "backward" | "forward") => () => {
      if (!this.options.enabled) return false;
      const { state, view } = this.editor;
      const insertType = state.schema.marks[SUGGESTION_INSERT];
      const deleteType = state.schema.marks[SUGGESTION_DELETE];
      if (!deleteType) return false;

      const { from, to, empty } = state.selection;
      let start = from;
      let end = to;
      if (empty) {
        if (direction === "backward") { start = Math.max(0, from - 1); end = from; }
        else { start = from; end = Math.min(state.doc.content.size, from + 1); }
      }
      if (end <= start) return false;

      // Two kinds of text in the range: something already proposed as an insertion,
      // which the author is still editing and may simply remove, and existing text,
      // which becomes a proposed deletion.
      const removals: Array<{ from: number; to: number }> = [];
      const deletions: Array<{ from: number; to: number }> = [];
      state.doc.nodesBetween(start, end, (node, position) => {
        if (!node.isText) return;
        const nodeStart = Math.max(start, position);
        const nodeEnd = Math.min(end, position + node.nodeSize);
        if (nodeEnd <= nodeStart) return;
        const own = insertType && insertType.isInSet(node.marks);
        (own ? removals : deletions).push({ from: nodeStart, to: nodeEnd });
      });
      if (!removals.length && !deletions.length) return false;

      const tr = state.tr.setMeta(suggestionKey, true);
      const attrs = { author: this.options.author, at: new Date().toISOString() };
      for (const range of deletions) tr.addMark(range.from, range.to, deleteType.create(attrs));
      // Back to front, so earlier positions stay valid as later text is removed.
      for (const range of [...removals].sort((a, b) => b.from - a.from)) tr.delete(range.from, range.to);

      if (empty && !removals.length) {
        // Nothing was removed, so step over the newly struck text instead of sitting
        // inside it and striking the same character again.
        const target = direction === "backward" ? start : end;
        tr.setSelection(Selection.near(tr.doc.resolve(Math.min(target, tr.doc.content.size))));
      }
      view.dispatch(tr.scrollIntoView());
      return true;
    };

    return {
      Backspace: markDeletion("backward"),
      Delete: markDeletion("forward"),
    };
  },

  addProseMirrorPlugins() {
    const options = () => this.options;
    const insertType = this.editor.schema.marks[SUGGESTION_INSERT];
    const deleteType = this.editor.schema.marks[SUGGESTION_DELETE];

    return [
      new Plugin({
        key: suggestionKey,

        /**
         * Blocks the deletion itself. A transaction that removes content while the mode
         * is on is rejected here and re-expressed as a delete mark in appendTransaction,
         * so no keystroke can quietly drop text.
         */
        filterTransaction(transaction, state) {
          if (!options().enabled || !transaction.docChanged) return true;
          if (transaction.getMeta(suggestionKey)) return true;
          let removesExistingText = false;
          transaction.steps.forEach((step, index) => {
            const map = step.getMap();
            const before = transaction.docs[index] ?? state.doc;
            map.forEach((start, end, newStart, newEnd) => {
              // A shrinking range means existing content would disappear.
              if (end - start > newEnd - newStart) {
                before.nodesBetween(start, end, (node) => {
                  if (node.isText) removesExistingText = true;
                });
              }
            });
          });
          return !removesExistingText;
        },

        /** Marks whatever the user just typed as an insertion. */
        appendTransaction(transactions, oldState, newState) {
          if (!options().enabled || !insertType) return null;
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          if (transactions.some((transaction) => transaction.getMeta(suggestionKey))) return null;

          const ranges: Array<{ from: number; to: number }> = [];
          for (const transaction of transactions) {
            transaction.steps.forEach((step, index) => {
              step.getMap().forEach((start, end, newStart, newEnd) => {
                void start; void end;
                if (newEnd > newStart) ranges.push({ from: newStart, to: newEnd });
              });
              void index;
            });
          }
          if (!ranges.length) return null;

          const tr = newState.tr.setMeta(suggestionKey, true).setMeta("addToHistory", false);
          const attrs = { author: options().author, at: new Date().toISOString() };
          let changed = false;
          for (const range of ranges) {
            const from = Math.max(0, Math.min(range.from, newState.doc.content.size));
            const to = Math.max(from, Math.min(range.to, newState.doc.content.size));
            if (to <= from) continue;
            // Text that is already marked deleted stays deleted: re-typing over a pending
            // removal should not silently resurrect it.
            newState.doc.nodesBetween(from, to, (node, position) => {
              if (!node.isText) return;
              if (deleteType && deleteType.isInSet(node.marks)) return;
              const start = Math.max(from, position);
              const end = Math.min(to, position + node.nodeSize);
              if (end <= start) return;
              tr.addMark(start, end, insertType.create(attrs));
              changed = true;
            });
          }
          void oldState;
          return changed ? tr : null;
        },
      }),
    ];
  },
});
