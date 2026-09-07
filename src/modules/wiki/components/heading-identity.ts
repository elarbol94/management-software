import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";

/** New/pasted headings get their own identity. Preserve the original target even
 * when a copy is pasted before it; ordinary moves retain the existing ID. */
export function headingIdentityPlugin() {
    return new Plugin({
      appendTransaction(transactions, oldState, state) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        const mapping = new Mapping(transactions.flatMap((transaction) => transaction.mapping.maps));
        const originals = new Map<string, number>();
        oldState.doc.descendants((node, position) => {
          if (node.type.name !== "heading" || !node.attrs.id) return;
          const mapped = mapping.mapResult(position, 1);
          if (!mapped.deleted && state.doc.nodeAt(mapped.pos)?.attrs.id === node.attrs.id) originals.set(String(node.attrs.id), mapped.pos);
        });
        const seen = new Set<string>();
        const transaction = state.tr;
        state.doc.descendants((node, position) => {
          if (node.type.name !== "heading") return;
          const id = String(node.attrs.id ?? "");
          if (!id || seen.has(id) || (originals.has(id) && originals.get(id) !== position)) {
            transaction.setNodeMarkup(position, undefined, { ...node.attrs, id: globalThis.crypto.randomUUID() });
          } else seen.add(id);
        });
        return transaction.docChanged ? transaction : null;
      },
    });
}

export const HeadingIdentity = Extension.create({
  name: "headingIdentity",
  addProseMirrorPlugins: () => [headingIdentityPlugin()],
});
