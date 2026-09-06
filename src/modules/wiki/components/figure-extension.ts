import { Extension, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";
import { figureRepairs } from "../lib/figure-identity";
export { figureRepairs } from "../lib/figure-identity";
import { FIGURE_ATTRIBUTES, figureWidth, isFigure, stripFigureNumber } from "../lib/figure";
import { FigureView } from "./figure-view";

export const CommentableImage = Node.create({
  name: "commentableImage", group: "block", atom: true, selectable: true, draggable: true,
  addAttributes: () => FIGURE_ATTRIBUTES,
  parseHTML: () => [{ tag: "figure[data-commentable-image]", getAttrs: (element) => {
    const stored = element.getAttribute("data-figure-attrs");
    try { if (stored) return JSON.parse(stored); } catch { /* Older clipboard formats use ordinary attributes. */ }
    return { nodeId: element.getAttribute("data-comment-node-id") || "", attachmentId: element.getAttribute("data-attachment-id") || "", src: element.querySelector("img")?.getAttribute("src") || "", caption: element.querySelector("figcaption")?.textContent || "", alt: element.querySelector("img")?.getAttribute("alt") || "" };
  } }],
  renderHTML: ({ node }) => ["figure", { "data-commentable-image": "", "data-comment-node-id": node.attrs.nodeId, "data-attachment-id": node.attrs.attachmentId, "data-figure-attrs": JSON.stringify(node.attrs), style: `width:${figureWidth(node.attrs.widthPercent)}%` }, ["img", { src: node.attrs.src, alt: node.attrs.alt }], ["figcaption", {}, stripFigureNumber(String(node.attrs.caption || ""))]],
  addNodeView() { return ReactNodeViewRenderer(FigureView); },
});

export const FigureIdentity = Extension.create({
  name: "figureIdentity",
  addProseMirrorPlugins() {
    return [new Plugin({ appendTransaction(transactions, oldState, state) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      const original = new Map<string, number>();
      oldState.doc.descendants((node, position) => {
        if (!isFigure(node.type.name) || !node.attrs.nodeId) return;
        let mapped = position, deleted = false;
        for (const transaction of transactions) { const result = transaction.mapping.mapResult(mapped); mapped = result.pos; deleted ||= result.deleted; }
        if (!deleted) original.set(String(node.attrs.nodeId), mapped);
      });
      const repairs = figureRepairs(state.doc, original);
      if (!repairs.length) return null;
      const transaction = state.tr;
      repairs.forEach(({ position, attrs }) => transaction.setNodeMarkup(position, undefined, attrs));
      return transaction;
    } })];
  },
});
