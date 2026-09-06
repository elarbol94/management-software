"use client";
import { useEffect, useState } from "react";
import { Node, Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { documentFigures } from "../lib/figure";
import { getDocumentNumberingState, getDocumentPaginationBreaks, pageForPosition } from "./document-extension";

function FigureListRowView({ node, editor }: NodeViewProps) {
  const [page, setPage] = useState(1);
  const [label, setLabel] = useState("");
  useEffect(() => {
    const update = () => {
      const numbering = getDocumentNumberingState(editor);
      setLabel(numbering?.labels.get(String(node.attrs.targetId)) ?? "");
      setPage(pageForPosition(getDocumentPaginationBreaks(editor), numbering?.positions.get(String(node.attrs.targetId)) ?? 0) + (numbering?.config.pageNumberStart ?? 1) - 1);
    };
    update(); editor.on("transaction", update);
    return () => { editor.off("transaction", update); };
  }, [editor, node.attrs.targetId]);
  return <NodeViewWrapper as="li" className="wiki-figure-list-row" contentEditable={false}>
    <button type="button" onClick={() => { const pos = getDocumentNumberingState(editor)?.positions.get(String(node.attrs.targetId)); if (pos !== undefined) (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ block: "center", behavior: "smooth" }); }}>
      <span>{label}: {String(node.attrs.caption || "")}</span><span className="wiki-figure-list-leader" /><span>{page}</span>
    </button>
  </NodeViewWrapper>;
}
export const FigureList = Node.create({
  name: "figureList", group: "block", content: "figureListEntry*", defining: true, isolating: true,
  addAttributes: () => ({ title: { default: "Abbildungsverzeichnis" }, pageBreakBefore: { default: false } }),
  parseHTML: () => [{ tag: "nav[data-figure-list]" }],
  renderHTML: ({ HTMLAttributes }) => ["nav", { "data-figure-list": "", "data-page-break-before": String(HTMLAttributes.pageBreakBefore === true), class: "wiki-figure-list" }, ["h2", { contenteditable: "false" }, HTMLAttributes.title], ["ol", {}, 0]],
});
export const FigureListEntry = Node.create({
  name: "figureListEntry", atom: true, selectable: false,
  addAttributes: () => ({ targetId: { default: "" }, caption: { default: "" }, number: { default: 0 } }),
  parseHTML: () => [{ tag: "li[data-figure-list-entry]" }],
  renderHTML: ({ HTMLAttributes }) => ["li", { "data-figure-list-entry": HTMLAttributes.targetId }, String(HTMLAttributes.caption || "")],
  addNodeView() { return ReactNodeViewRenderer(FigureListRowView); },
});
export const FigureListSync = Extension.create({
  name: "figureListSync",
  addProseMirrorPlugins() {
    return [new Plugin({ appendTransaction(transactions, _old, state) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      const rows = documentFigures(state.doc.toJSON()).filter((figure) => figure.included).map((figure) => state.schema.nodes.figureListEntry.create({ targetId: figure.nodeId, caption: figure.caption, number: figure.number }));
      const transaction = state.tr;
      state.doc.descendants((node, position) => {
        if (node.type.name !== "figureList") return;
        const replacement = node.type.create(node.attrs, rows);
        if (!replacement.eq(node)) transaction.replaceWith(transaction.mapping.map(position), transaction.mapping.map(position + node.nodeSize), replacement);
        return false;
      });
      return transaction.docChanged ? transaction : null;
    } })];
  },
});
