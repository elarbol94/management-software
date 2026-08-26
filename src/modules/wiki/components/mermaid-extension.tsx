"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";

export const MERMAID_PLACEHOLDER = `flowchart TD
  A[Antrag] --> B{Prüfung}
  B -->|angenommen| C[Bescheid]
  B -->|abgelehnt| D[Ablehnung]`;

/**
 * Renders mermaid source to SVG. mermaid is ~1MB bundled, so it is imported on first
 * use rather than with the editor, and initialised once per page.
 */
let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid(dark: boolean) {
  mermaidReady ??= import("mermaid").then((module) => {
    module.default.initialize({
      startOnLoad: false,
      // The editor renders trusted, locally authored diagrams; "strict" would strip the
      // labels people actually write.
      securityLevel: "loose",
      theme: dark ? "dark" : "default",
      fontFamily: "inherit",
    });
    return module.default;
  });
  return mermaidReady;
}

function MermaidView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const t = useTranslations("wiki");
  const code = String(node.attrs.code ?? "");
  const cachedSvg = String(node.attrs.svg ?? "");
  const [editing, setEditing] = useState(!code.trim());
  const [draft, setDraft] = useState(code);
  const [svg, setSvg] = useState(cachedSvg);
  const [error, setError] = useState("");
  const renderId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const latestRender = useRef(0);

  // Only ever called with non-empty source, so it never sets state synchronously.
  const render = useCallback(async (source: string) => {
    const request = ++latestRender.current;
    try {
      const dark = document.documentElement.classList.contains("dark");
      const mermaid = await loadMermaid(dark);
      const { svg: output } = await mermaid.render(`mermaid-${renderId}-${request}`, source);
      if (latestRender.current !== request) return "";
      setSvg(output);
      setError("");
      return output;
    } catch (reason) {
      if (latestRender.current !== request) return "";
      setError(reason instanceof Error ? reason.message : t("mermaid.renderFailed"));
      return "";
    }
  }, [renderId, t]);

  // Render the stored source when the cache is empty, e.g. a diagram pasted as JSON.
  useEffect(() => {
    if (!cachedSvg && code.trim()) void render(code);
  }, [cachedSvg, code, render]);

  async function commit() {
    setEditing(false);
    if (draft === code && cachedSvg) return;
    if (!draft.trim()) {
      setSvg("");
      setError("");
      updateAttributes({ code: "", svg: "" });
      return;
    }
    // The SVG is a cache: the source stays authoritative so revisions diff as text,
    // while exports have something to emit without running mermaid on the server.
    const output = await render(draft);
    updateAttributes({ code: draft, svg: output });
  }

  const editable = editor.isEditable;

  return (
    <NodeViewWrapper
      className={`my-3 rounded-lg border ${selected ? "ring-2 ring-indigo-400" : ""}`}
      data-mermaid-diagram=""
    >
      {editing && editable ? (
        <div className="p-2">
          <textarea
            autoFocus
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); setDraft(code); setEditing(false); }
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void commit(); }
            }}
            aria-label={t("mermaid.source")}
            className="min-h-32 w-full resize-y rounded-md border bg-muted/20 p-2 font-mono text-xs outline-none focus-visible:ring-1"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">{t("mermaid.editHint")}</p>
        </div>
      ) : (
        <button
          type="button"
          disabled={!editable}
          onClick={() => { setDraft(code); setEditing(true); }}
          className="block w-full cursor-text p-3 text-left disabled:cursor-default"
          aria-label={t("mermaid.edit")}
        >
          {svg
            // Output comes from mermaid rendering source the user typed in their own
            // workspace, the same trust level as the rest of the document.
            ? <span className="block [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
            : <span className="block whitespace-pre-wrap font-mono text-xs text-muted-foreground">{code || t("mermaid.empty")}</span>}
        </button>
      )}
      {error && <p role="alert" className="border-t px-3 py-2 text-xs text-destructive">{error}</p>}
    </NodeViewWrapper>
  );
}

export const MermaidDiagram = Node.create({
  name: "mermaidDiagram",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      code: { default: "" },
      /** Cached render, so exports need no mermaid runtime on the server. */
      svg: { default: "" },
    };
  },

  parseHTML() {
    return [{
      tag: "div[data-mermaid-diagram]",
      getAttrs: (element) => ({
        code: (element as HTMLElement).getAttribute("data-code") ?? "",
        svg: "",
      }),
    }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-mermaid-diagram": "", "data-code": HTMLAttributes.code })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
});
