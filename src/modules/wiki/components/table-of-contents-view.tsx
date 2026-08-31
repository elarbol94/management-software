"use client";

import { useEffect, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { getDocumentPaginationBreaks, numberHeadings, pageForPosition } from "./document-extension";

type HeadingEntry = { level: number; text: string; position: number };

function collectHeadings(editor: NodeViewProps["editor"]): HeadingEntry[] {
  const items: HeadingEntry[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "heading") items.push({ level: Number(node.attrs.level), text: node.textContent, position });
  });
  return items;
}

export function TableOfContentsView({ node, editor, selected }: NodeViewProps) {
  const t = useTranslations("wiki");
  const maxLevel = Number(node.attrs.maxLevel) || 3;
  const title = String(node.attrs.title || "");
  // Every heading in the doc, not just ones within maxLevel: the section numbers
  // (1, 1.2, 1.2.3) count all headings, matching the CSS counters used for
  // export and the live editor canvas — only which rows are *listed* is filtered.
  const [headings, setHeadings] = useState<HeadingEntry[]>(() => collectHeadings(editor));
  const [breaks, setBreaks] = useState(() => getDocumentPaginationBreaks(editor));

  useEffect(() => {
    let frame = 0;
    const scheduleRefresh = () => {
      cancelAnimationFrame(frame);
      // Pagination re-measures on every keystroke; batching to one frame keeps
      // this list from re-walking the document mid-burst.
      frame = requestAnimationFrame(() => {
        setHeadings(collectHeadings(editor));
        setBreaks(getDocumentPaginationBreaks(editor));
      });
    };
    scheduleRefresh();
    // "transaction" (not "update") also fires for the meta-only dispatches the
    // pagination effect uses to publish new page breaks, so page numbers stay live.
    editor.on("transaction", scheduleRefresh);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("transaction", scheduleRefresh);
    };
  }, [editor]);

  const documentMode = editor.view.dom.closest('[data-document-mode="true"]') !== null;
  const numberedHeadings = editor.view.dom.closest('[data-numbered-headings="true"]') !== null;
  const labels = numberHeadings(headings);
  const entries = headings
    .map((heading, index) => ({ ...heading, label: labels[index] }))
    .filter((heading) => heading.level <= maxLevel);

  function jumpTo(position: number) {
    const heading = editor.view.nodeDOM(position) as HTMLElement | null;
    const top = heading?.getBoundingClientRect().top ?? 0;
    window.scrollBy({ top: top - 84, behavior: "smooth" });
    editor.chain().focus().setTextSelection(position + 1).run();
  }

  return (
    <NodeViewWrapper className={`wiki-document-toc${selected ? " ring-2 ring-indigo-400" : ""}`} data-document-toc="">
      <strong>{title || t("document.contents")}</strong>
      {entries.length
        ? <ol className="mt-1 space-y-0.5">
            {entries.map((heading) => <li key={heading.position} className={`toc-level-${heading.level}`} style={{ paddingLeft: `${(heading.level - 1) * 0.85}rem` }}>
              <button
                type="button"
                disabled={!editor.isEditable}
                onClick={() => jumpTo(heading.position)}
                className="flex w-full items-baseline justify-between gap-2 rounded-sm py-0.5 text-left hover:underline disabled:cursor-default disabled:no-underline"
              >
                <span>{numberedHeadings && heading.label ? heading.label : ""}{heading.text || t("editor.outline.untitled")}</span>
                {documentMode && <span className="shrink-0 text-xs text-muted-foreground">{t("document.page")} {pageForPosition(breaks, heading.position)}</span>}
              </button>
            </li>)}
          </ol>
        : <p>{t("editor.outline.empty")}</p>}
    </NodeViewWrapper>
  );
}
