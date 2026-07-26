import { mergeAttributes } from "@tiptap/core";
import Heading from "@tiptap/extension-heading";
import ListItem from "@tiptap/extension-list-item";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const collapsibleHeadingKey = new PluginKey("wikiCollapsibleHeading");

function collapsedDecorations(doc: Parameters<typeof DecorationSet.create>[0]) {
  const headings: Array<{ position: number; level: number; collapsed: boolean }> = [];
  doc.descendants((node, position) => {
    if (node.type.name === "heading") headings.push({
      position,
      level: Number(node.attrs.level),
      collapsed: Boolean(node.attrs.collapsed),
    });
  });
  const decorations: Decoration[] = [];
  for (const heading of headings) {
    if (!heading.collapsed) continue;
    const end = headings.find((candidate) => candidate.position > heading.position && candidate.level <= heading.level)?.position ?? doc.content.size;
    doc.nodesBetween(heading.position + 1, end, (node, position) => {
      if (node.isBlock && node.type.name !== "heading") {
        decorations.push(Decoration.node(position, position + node.nodeSize, { class: "wiki-collapsed-section" }));
        return false;
      }
      return true;
    });
  }
  return DecorationSet.create(doc, decorations);
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
    return [new Plugin({
      key: collapsibleHeadingKey,
      props: {
        decorations: (state) => collapsedDecorations(state.doc),
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
          view.dispatch(view.state.tr.setNodeMarkup(headingPosition, undefined, {
            ...heading.attrs,
            collapsed: !heading.attrs.collapsed,
          }));
          return true;
        },
      },
    })];
  },
});

// TipTap's default list item requires a paragraph as its first child.  Allowing
// any block here permits headings directly inside bullet and ordered lists.
export const HeadingListItem = ListItem.extend({ content: "block+" });
