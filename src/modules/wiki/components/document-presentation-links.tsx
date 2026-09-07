"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Presentation } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { revealHeadingSections } from "./collapsible-heading";
import { presentationElementHref, type DocumentPresentationLink } from "../lib/presentation-source";
import { documentScrollContainers, readLinkedPosition, rememberLinkedPosition } from "../lib/linked-navigation";

const linksKey = new PluginKey("documentPresentationLinks");

export function DocumentPresentationLinks({ editor, pageId, slug, flush }: {
  editor: Editor; pageId: string; slug: string; flush: () => Promise<boolean>;
}) {
  const t = useTranslations("documentPresentationLinks");
  const router = useRouter();
  const query = useSearchParams();
  const [links, setLinks] = useState<DocumentPresentationLink[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sectionFilter, setSectionFilter] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const navigating = useRef(false);
  const sectionId = query.get("section");
  const resume = query.get("resume");
  const documentResume = query.get("documentResume");
  const returnId = query.get("presentation");
  const returnElement = query.get("element") ?? "";
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/wiki/presentation-sources?page=${encodeURIComponent(pageId)}`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json(); setLinks(result.links); setLoadFailed(false);
    } catch { if (!signal?.aborted) setLoadFailed(true); }
  }, [pageId]);
  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => void load(controller.signal));
    const refresh = () => void load(controller.signal);
    window.addEventListener("focus", refresh);
    return () => { cancelAnimationFrame(frame); controller.abort(); window.removeEventListener("focus", refresh); };
  }, [load]);

  useEffect(() => {
    editor.registerPlugin(new Plugin({
      key: linksKey,
      props: {
        decorations(state) {
          const decorations: Decoration[] = [];
          state.doc.descendants((node, position) => {
            if (node.type.name !== "heading") return;
            const matches = links.filter((link) => link.sectionId === node.attrs.id);
            if (!matches.length) return;
            const count = new Set(matches.map((link) => link.presentationId)).size;
            decorations.push(Decoration.widget(position + node.nodeSize - 1, () => {
              const badge = document.createElement("button");
              badge.type = "button"; badge.contentEditable = "false";
              badge.className = "wiki-presentation-section-badge";
              badge.dataset.sectionId = String(node.attrs.id);
              badge.textContent = t("badge", { count });
              badge.setAttribute("aria-label", t("sectionPresentations", { section: node.textContent, count }));
              badge.addEventListener("mousedown", (event) => event.preventDefault());
              badge.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); setSectionFilter(String(node.attrs.id)); setOpen(true); });
              return badge;
            }, { key: `presentation-links-${node.attrs.id}-${count}-${node.textContent}`, side: 1, stopEvent: () => true }));
          });
          return DecorationSet.create(state.doc, decorations);
        },
      },
    }));
    return () => { if (!editor.isDestroyed) editor.unregisterPlugin(linksKey); };
  }, [editor, links, t]);

  useEffect(() => {
    if (sectionId === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let highlighted: HTMLElement | null = null;
    const frame = requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      const headings: Array<{ pos: number; level: number; id: string }> = [];
      editor.state.doc.descendants((node, pos) => { if (node.type.name === "heading") headings.push({ pos, level: Number(node.attrs.level), id: String(node.attrs.id) }); });
      const target = headings.find((heading) => heading.id === sectionId);
      setMissing(Boolean(sectionId && !target));
      if (sectionId && !target) return;
      const stack: typeof headings = [];
      for (const heading of headings) {
        if (heading.pos > (target?.pos ?? 0)) break;
        while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
        stack.push(heading);
      }
      const transaction = revealHeadingSections(editor.state.tr, stack.map((heading) => heading.id)).setMeta("addToHistory", false);
      const saved = readLinkedPosition(documentResume);
      const restore = saved?.kind === "document" && saved.id === pageId ? saved : null;
      const from = Math.min(restore?.from ?? (target ? target.pos + 1 : 1), transaction.doc.content.size);
      const to = Math.min(restore?.to ?? from, transaction.doc.content.size);
      transaction.setSelection(TextSelection.between(transaction.doc.resolve(from), transaction.doc.resolve(to)));
      editor.view.dispatch(transaction);
      // Pagination reacts to expanding a section; scroll after its layout pass.
      timer = setTimeout(() => {
        if (editor.isDestroyed) return;
        const dom = target ? editor.view.nodeDOM(target.pos) : editor.view.dom;
        highlighted = dom instanceof HTMLElement ? dom : null;
        highlighted?.scrollIntoView({ block: "center", behavior: "instant" });
        highlighted?.setAttribute("data-linked-section-focus", "true");
        if (restore) documentScrollContainers(editor.view.dom).forEach((container, index) => { container.scrollTop = restore.scroll[index] ?? container.scrollTop; });
        timer = setTimeout(() => highlighted?.removeAttribute("data-linked-section-focus"), 3500);
      }, 250);
    });
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); highlighted?.removeAttribute("data-linked-section-focus"); };
  }, [documentResume, editor, pageId, sectionId]);

  async function navigate(presentationId: string, elementId: string, returnResume?: string) {
    if (navigating.current) return;
    navigating.current = true;
    try {
      if (!await flush()) { toast.error(t("saveFailed")); return; }
      const token = rememberLinkedPosition({ kind: "document", id: pageId, slug, sectionId: sectionFilter ?? sectionId ?? "", from: editor.state.selection.from, to: editor.state.selection.to, scroll: documentScrollContainers(editor.view.dom).map((container) => container.scrollTop) });
      let href = presentationElementHref(presentationId, elementId, returnResume);
      if (token) href += `&documentResume=${encodeURIComponent(token)}`;
      setOpen(false);
      router.push(href);
    } catch { toast.error(t("saveFailed")); }
    finally { navigating.current = false; }
  }
  const visible = sectionFilter === null ? links : links.filter((link) => link.sectionId === sectionFilter);
  if (!returnId && !links.length && !loadFailed && !missing) return null;
  return <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="document-presentation-links">
    {returnId && <Button size="sm" variant="outline" onClick={() => void navigate(returnId, returnElement, resume ?? undefined)}><ArrowLeft className="size-4" />{t("backPresentation")}</Button>}
    {links.length > 0 && <Button size="sm" variant="ghost" onClick={() => { setSectionFilter(null); setOpen(true); }}><Presentation className="size-4" />{t("linkedPresentations", { count: new Set(links.map((link) => link.presentationId)).size })}</Button>}
    {loadFailed && <Button size="sm" variant="ghost" onClick={() => void load()}>{t("retry")}</Button>}
    {missing && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{t("missingSource")}</p>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{t("presentations")}</DialogTitle><DialogDescription>{t("choosePresentation")}</DialogDescription></DialogHeader>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">{visible.map((link) => <Button key={`${link.presentationId}:${link.elementId}`} variant="outline" className="h-auto w-full justify-start whitespace-normal py-3 text-left" onClick={() => void navigate(link.presentationId, link.elementId)}><Presentation className="size-4 shrink-0" /><span>{link.title}<span className="block text-xs text-muted-foreground">{link.label}</span></span></Button>)}</div>
    </DialogContent></Dialog>
  </div>;
}
