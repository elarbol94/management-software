import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { canDropFigureInText, draggedFigure, dropFigureInText } from "../lib/figure-drop";

const key = new PluginKey<number | null>("figureTextDrop");
function target(view: EditorView, event: DragEvent) {
  const figure = draggedFigure(view.dragging?.slice);
  const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
  return view.editable && figure && position !== undefined && canDropFigureInText(view.state.doc, position, figure) ? position : null;
}

export const FigureTextDrop = Extension.create({
  name: "figureTextDrop",
  // Suppress the ordinary boundary marker only where the exact text caret applies.
  extendNodeSchema() {
    return { disableDropCursor: (view: EditorView, _position: unknown, event: DragEvent) => target(view, event) !== null };
  },
  addProseMirrorPlugins() {
    return [new Plugin<number | null>({
      key,
      state: {
        init: () => null,
        apply(transaction, previous) {
          const position = transaction.getMeta(key) as { position: number | null } | undefined;
          if (position) return position.position;
          return previous === null ? null : transaction.mapping.map(previous);
        },
      },
      props: {
        decorations(state) {
          const position = key.getState(state);
          if (position == null) return null;
          return DecorationSet.create(state.doc, [Decoration.widget(position, () => {
            const marker = document.createElement("span");
            marker.className = "wiki-figure-text-drop-caret";
            marker.setAttribute("aria-hidden", "true");
            return marker;
          }, { side: -1 })]);
        },
        handleDrop(view, event, slice, moved) {
          if (!view.editable || !view.dragging) return false;
          const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          const transaction = position === undefined ? null : dropFigureInText(view.state, position, slice, moved);
          if (!transaction) return false;
          view.dispatch(transaction.setMeta(key, { position: null }));
          view.focus();
          return true;
        },
      },
      view(view) {
        let markerParent: Element | null = null;
        const update = (position: number | null) => {
          const parent = view.dom.offsetParent;
          if (markerParent !== parent) markerParent?.classList.remove("wiki-figure-text-drop-active");
          markerParent = parent;
          markerParent?.classList.toggle("wiki-figure-text-drop-active", position !== null);
          if (!view.isDestroyed && key.getState(view.state) !== position) view.dispatch(view.state.tr.setMeta(key, { position }).setMeta("addToHistory", false));
        };
        const dragover = (event: DragEvent) => update(target(view, event));
        const clear = () => update(null);
        const leave = (event: DragEvent) => { if (!(event.relatedTarget instanceof globalThis.Node) || !view.dom.contains(event.relatedTarget)) clear(); };
        view.dom.addEventListener("dragover", dragover);
        view.dom.addEventListener("dragleave", leave);
        document.addEventListener("drop", clear);
        document.addEventListener("dragend", clear);
        return { destroy() {
          markerParent?.classList.remove("wiki-figure-text-drop-active");
          view.dom.removeEventListener("dragover", dragover);
          view.dom.removeEventListener("dragleave", leave);
          document.removeEventListener("drop", clear);
          document.removeEventListener("dragend", clear);
        } };
      },
    })];
  },
});
