import { mergeAttributes } from "@tiptap/core";
import Heading from "@tiptap/extension-heading";
import ListItem from "@tiptap/extension-list-item";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin, PluginKey, type Transaction, type EditorState } from "@tiptap/pm/state";

const collapsibleHeadingKey = new PluginKey<Set<string>>("wikiCollapsibleHeading");

/** Revealing a navigation target is view state, so it also works without an edit
 * lease and never creates an unsaved document merely by opening a source link. */
export function revealHeadingSections(transaction: Transaction, ids: string[]): Transaction {
  return transaction.setMeta(collapsibleHeadingKey, { reveal: ids });
}

export function headingVisibilityChanged(transaction: Transaction): boolean {
  return Boolean(transaction.getMeta(collapsibleHeadingKey));
}

function headingRanges(doc: EditorState["doc"], revealed: Set<string>) {
  const headings: Array<{ position: number; end: number; level: number; collapsed: boolean }> = [];
  doc.descendants((node, position) => {
    if (node.type.name === "heading") headings.push({ position, end: position + node.nodeSize, level: Number(node.attrs.level), collapsed: Boolean(node.attrs.collapsed) && !revealed.has(String(node.attrs.id)) });
  });
  const ranges: Array<{ from: number; to: number }> = [];
  for (const heading of headings) {
    if (!heading.collapsed) continue;
    const to = headings.find((candidate) => candidate.position > heading.position && candidate.level <= heading.level)?.position ?? doc.content.size;
    if (heading.end >= to) continue;
    const previous = ranges.at(-1);
    if (previous && heading.end <= previous.to) previous.to = Math.max(previous.to, to);
    else ranges.push({ from: heading.end, to });
  }
  return ranges;
}

export function collapsedHeadingRanges(state: EditorState) {
  return headingRanges(state.doc, collapsibleHeadingKey.getState(state) ?? new Set());
}

function collapsedDecorations(doc: EditorState["doc"], revealed: Set<string>) {
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === "heading" && revealed.has(String(node.attrs.id))) decorations.push(Decoration.node(position, position + node.nodeSize, { "aria-expanded": "true", "data-collapsed": "false" }));
  });
  for (const { from, to } of headingRanges(doc, revealed)) {
    doc.nodesBetween(from, to, (node, position) => {
      // nodesBetween also visits ancestors crossing the boundary. Hiding those
      // would hide the heading itself when it lives inside a list or column.
      if (node.isBlock && position >= from && position + node.nodeSize <= to) {
        decorations.push(Decoration.node(position, position + node.nodeSize, { class: "wiki-collapsed-section" }));
        return false;
      }
      return true;
    });
  }
  return DecorationSet.create(doc, decorations);
}

export function headingCollapsePlugin() {
  return new Plugin<Set<string>>({
      key: collapsibleHeadingKey,
      state: {
        init: () => new Set<string>(),
        apply(transaction, previous) {
          const meta = transaction.getMeta(collapsibleHeadingKey) as { reveal?: string[]; clear?: string } | undefined;
          if (!meta) return previous;
          const next = new Set(previous);
          meta.reveal?.forEach((id) => next.add(id));
          if (meta.clear) next.delete(meta.clear);
          return next;
        },
      },
      props: {
        decorations: (state) => collapsedDecorations(state.doc, collapsibleHeadingKey.getState(state) ?? new Set()),
        handleClick: (view, position, event) => {
          const element = event.target instanceof Element
            ? event.target.closest("[data-wiki-collapsible-heading]")
            : null;
          if (!element) return false;
          const resolved = view.state.doc.resolve(position);
          const headingPosition = resolved.depth > 0 && resolved.parent.type.name === "heading"
            ? resolved.before(resolved.depth)
            : null;
          if (headingPosition === null) return false;
          const heading = view.state.doc.nodeAt(headingPosition);
          if (!heading) return false;
          event.preventDefault();
          const id = String(heading.attrs.id);
          const collapsed = heading.attrs.collapsed && !collapsibleHeadingKey.getState(view.state)?.has(id);
          view.dispatch(view.state.tr.setNodeMarkup(headingPosition, undefined, {
            ...heading.attrs,
            collapsed: !collapsed,
          }).setMeta(collapsibleHeadingKey, { clear: id }));
          return true;
        },
      },
  });
}

/** Heading blocks can fold their following section without persisting UI state. */
export const CollapsibleHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-collapsed") === "true",
        renderHTML: (attributes) => ({ "data-collapsed": attributes.collapsed ? "true" : undefined }),
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs.level;
    return [`h${level}`, mergeAttributes(HTMLAttributes, {
      "data-wiki-collapsible-heading": "true",
      "aria-expanded": node.attrs.collapsed ? "false" : "true",
    }), 0];
  },
  addProseMirrorPlugins() {
    return [headingCollapsePlugin()];
  },
});

// TipTap's default list item requires a paragraph as its first child.  Allowing
// any block here permits headings directly inside bullet and ordered lists.
export const HeadingListItem = ListItem.extend({ content: "block+" });
