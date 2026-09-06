import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type PendingUpload = { id: string; label: string; cancelLabel: string; cancel: () => void };
const key = new PluginKey<DecorationSet>("figureUploads");
export const FigureUploads = Extension.create({
  name: "figureUploads",
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({ key, state: {
      init: () => DecorationSet.empty,
      apply(transaction, previous) {
        let next = previous.map(transaction.mapping, transaction.doc);
        const action = transaction.getMeta(key) as { add?: PendingUpload & { position: number }; remove?: string } | undefined;
        if (action?.remove) next = next.remove(next.find(undefined, undefined, (spec) => spec.id === action.remove));
        if (action?.add) {
          const { position, ...upload } = action.add;
          next = next.add(transaction.doc, [Decoration.widget(position, () => {
            const element = document.createElement("span"); element.className = "wiki-figure-upload"; element.contentEditable = "false"; element.setAttribute("role", "status");
            const label = document.createElement("span"); label.textContent = upload.label;
            const button = document.createElement("button"); button.type = "button"; button.textContent = upload.cancelLabel; button.onclick = upload.cancel;
            element.append(label, button); return element;
          }, { id: upload.id, side: -1 })]);
        }
        return next;
      },
    }, props: { decorations(state) { return key.getState(state); } } })];
  },
});
export function uploadPosition(editor: Editor, id: string) { return key.getState(editor.state)?.find(undefined, undefined, (spec) => spec.id === id)[0]?.from; }
export function addUpload(editor: Editor, position: number, upload: PendingUpload) { editor.view.dispatch(editor.state.tr.setMeta(key, { add: { ...upload, position } }).setMeta("addToHistory", false)); }
export function removeUpload(editor: Editor, id: string) { if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, { remove: id }).setMeta("addToHistory", false)); }
