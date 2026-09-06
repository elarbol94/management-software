"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { FIGURE_ATTRIBUTES } from "../lib/figure";
import { FigureView } from "./figure-view";

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
      // Keep active links and HTML disabled; vector labels survive in stored/exported SVG.
      securityLevel: "strict",
      flowchart: { htmlLabels: false },
      theme: dark ? "dark" : "default",
      fontFamily: "inherit",
    });
    return module.default;
  });
  return mermaidReady;
}

// Mermaid's scoped stylesheet is flattened inside a shadow root, so the stored SVG
// needs neither HTML labels nor a stylesheet and passes the attachment validator.
function inlineDiagramStyles(svg: string) {
  const host = document.createElement("div"); host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = svg;
  document.body.append(host);
  try {
    for (const element of Array.from(shadow.querySelectorAll<SVGElement>("svg *"))) {
      if (element.tagName.toLowerCase() === "style") continue;
      const computed = getComputedStyle(element);
      const properties = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "color"];
      for (const property of properties) element.style.setProperty(property, computed.getPropertyValue(property));
      for (const attribute of Array.from(element.attributes)) {
        if (/^on/i.test(attribute.name) || ((attribute.name === "href" || attribute.name === "xlink:href") && !attribute.value.startsWith("#"))) element.removeAttribute(attribute.name);
      }
    }
    shadow.querySelectorAll("style, foreignObject, script").forEach((element) => element.remove());
    return shadow.querySelector("svg")?.outerHTML || "";
  } finally { host.remove(); }
}

function MermaidView(props: NodeViewProps) {
  const { node, updateAttributes, editor } = props;
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
      const { svg: rendered } = await mermaid.render(`mermaid-${renderId}-${request}`, source);
      const output = inlineDiagramStyles(rendered);
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
    if ((!cachedSvg || /<style\b|<foreignObject\b/i.test(cachedSvg)) && code.trim()) void render(code).then((output) => { if (output && editor.isEditable) updateAttributes({ svg: output }); });
  }, [cachedSvg, code, render, editor, updateAttributes]);

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

  return <FigureView {...props} imageSrc={svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : undefined}>
    {editable && (props.selected || editing || error) && <div contentEditable={false} className="wiki-figure-controls">
      {editing ? <textarea autoFocus value={draft} spellCheck={false} aria-label={t("mermaid.source")}
        onChange={(event) => setDraft(event.target.value)} onBlur={() => void commit()}
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { setDraft(code); setEditing(false); } if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void commit(); } }}
        className="min-h-32 w-full rounded border p-2 font-mono text-xs" />
        : <button type="button" onClick={() => { setDraft(code); setEditing(true); }} className="text-xs underline">{t("mermaid.edit")}</button>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>}
  </FigureView>;
}

export const MermaidDiagram = Node.create({
  name: "mermaidDiagram",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      ...FIGURE_ATTRIBUTES,
      code: { default: "" },
      /** Cached render, so exports need no mermaid runtime on the server. */
      svg: { default: "" },
    };
  },

  parseHTML() {
    return [{
      tag: "div[data-mermaid-diagram]",
      getAttrs: (element) => {
        try { const stored = element.getAttribute("data-figure-attrs"); if (stored) return JSON.parse(stored); } catch { /* Legacy diagrams only stored source. */ }
        return { code: element.getAttribute("data-code") ?? "", svg: "" };
      },
    }];
  },

  renderHTML({ node }) {
    return ["div", mergeAttributes({ "data-mermaid-diagram": "", "data-code": node.attrs.code, "data-figure-attrs": JSON.stringify(node.attrs) })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
});
