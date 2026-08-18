"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { isAllowedUri } from "@tiptap/extension-link";
import { useTranslations } from "next-intl";
import { CaseSensitive, Check, ChevronDown, ExternalLink, Link2, Replace, Search, WholeWord, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { findEditorMatches, replaceEditorMatches, setEditorSearch, type SearchOptions } from "../lib/editor-search";

type PageRef = { id: string; title: string; slug: string };
export type OutlineItem = { level: number; text: string; position: number; id: string };

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(?:https?:\/\/|mailto:|tel:|\/)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function EditorLinkPopover({ editor, pages, request = 0 }: { editor: Editor; pages: PageRef[]; request?: number }) {
  const t = useTranslations("wiki.editor");
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const range = useRef({ from: 0, to: 0 });

  function prepare() {
    const { from, to } = editor.state.selection;
    range.current = { from, to };
    setLabel(editor.state.doc.textBetween(from, to, " "));
    setUrl(String(editor.getAttributes("link").href ?? ""));
    setError("");
    setOpen(true);
  }

  useEffect(() => {
    if (request <= 0) return;
    const frame = requestAnimationFrame(() => {
      const { from, to } = editor.state.selection;
      range.current = { from, to };
      setLabel(editor.state.doc.textBetween(from, to, " "));
      setUrl(String(editor.getAttributes("link").href ?? ""));
      setError("");
      setOpen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, request]);

  function apply(href = url, text = label) {
    const normalized = normalizeUrl(href);
    if (!normalized || !isAllowedUri(normalized)) { setError(t("link.invalid")); return; }
    const { from, to } = range.current;
    const chain = editor.chain().focus();
    if (from === to) {
      chain.setTextSelection(from).insertContent({
        type: "text",
        text: text.trim() || normalized,
        marks: [{ type: "link", attrs: { href: normalized } }],
      }).run();
    } else {
      chain.setTextSelection({ from, to }).setLink({ href: normalized }).run();
    }
    setOpen(false);
  }

  const suggestions = useMemo(() => {
    const query = (label || url).trim().toLocaleLowerCase();
    if (!query) return pages.slice(0, 5);
    return pages.filter((page) => page.title.toLocaleLowerCase().includes(query)).slice(0, 5);
  }, [label, pages, url]);

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button type="button" variant={editor.isActive("link") ? "secondary" : "ghost"} size="icon-sm" aria-label={t("link.button")} aria-pressed={editor.isActive("link")} onMouseDown={(event) => event.preventDefault()} onClick={prepare} />}>
      <Link2 className="size-4 rotate-45" />
    </PopoverTrigger>
    <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] space-y-3 p-3">
      <div>
        <p className="text-sm font-medium">{t("link.title")}</p>
        <p className="text-xs text-muted-foreground">{t("link.description")}</p>
      </div>
      <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("link.text")} aria-label={t("link.text")} />
      <Input autoFocus value={url} onChange={(event) => { setUrl(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); apply(); } }} placeholder="https://example.com" aria-label={t("link.url")} />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {suggestions.length > 0 && <div className="border-t pt-2">
        <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t("link.pages")}</p>
        {suggestions.map((page) => <button key={page.id} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1" onClick={() => apply(`/wiki/pages/${page.slug}`, page.title)}>
          <Link2 className="size-3.5 text-indigo-500" /><span className="truncate">{page.title}</span>
        </button>)}
      </div>}
      <div className="flex justify-between gap-2 border-t pt-2">
        <div className="flex gap-1">
          {editor.isActive("link") && <Button type="button" size="sm" variant="ghost" onClick={() => { editor.chain().focus().unsetLink().run(); setOpen(false); }}>{t("link.remove")}</Button>}
          {url && <Button type="button" size="icon-sm" variant="ghost" aria-label={t("link.open")} onClick={() => window.open(normalizeUrl(url), "_blank", "noopener,noreferrer")}><ExternalLink className="size-4" /></Button>}
        </div>
        <Button type="button" size="sm" onClick={() => apply()}><Check className="size-3.5" />{t("link.apply")}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}

export function EditorSearchPanel({ editor, open, onOpenChange, initialQuery = "" }: { editor: Editor; open: boolean; onOpenChange: (open: boolean) => void; initialQuery?: string }) {
  const t = useTranslations("wiki.editor.search");
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [current, setCurrent] = useState(0);
  const rawMatches = findEditorMatches(editor.state.doc, { query, caseSensitive, wholeWord });
  const boundedCurrent = rawMatches.length ? Math.min(current, rawMatches.length - 1) : 0;
  const options: SearchOptions = { query, caseSensitive, wholeWord, current: boundedCurrent };
  const matches = findEditorMatches(editor.state.doc, options);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
    else setEditorSearch(editor, { query: "", caseSensitive, wholeWord, current: 0 });
  }, [caseSensitive, editor, open, wholeWord]);
  useEffect(() => {
    if (!open) return;
    setEditorSearch(editor, { query, caseSensitive, wholeWord, current: boundedCurrent });
  }, [boundedCurrent, caseSensitive, editor, matches.length, open, query, wholeWord]);

  function move(delta: number) {
    if (!matches.length) return;
    setCurrent((value) => (value + delta + matches.length) % matches.length);
  }

  function replace(all: boolean) {
    replaceEditorMatches(editor, options, replacement, all);
    setCurrent(0);
    requestAnimationFrame(() => setEditorSearch(editor, { ...options, current: 0 }));
  }

  if (!open) return null;
  return <div data-testid="editor-search-panel" role="search" className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/35 p-2 shadow-sm" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); onOpenChange(false); editor.commands.focus(); }
    if (event.key === "Enter" && event.target === inputRef.current) { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
  }}>
    <div className="relative min-w-48 flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setCurrent(0); }} className="h-8 pl-8" placeholder={t("placeholder")} aria-label={t("placeholder")} />
    </div>
    <span aria-live="polite" className="min-w-16 text-center text-xs text-muted-foreground">{matches.length ? t("results", { current: boundedCurrent + 1, total: matches.length }) : t("noResults")}</span>
    <Button type="button" size="icon-sm" variant={caseSensitive ? "secondary" : "ghost"} aria-label={t("caseSensitive")} aria-pressed={caseSensitive} onClick={() => setCaseSensitive((value) => !value)}><CaseSensitive className="size-4" /></Button>
    <Button type="button" size="icon-sm" variant={wholeWord ? "secondary" : "ghost"} aria-label={t("wholeWord")} aria-pressed={wholeWord} onClick={() => setWholeWord((value) => !value)}><WholeWord className="size-4" /></Button>
    <Button type="button" size="icon-sm" variant="ghost" aria-label={t("previous")} disabled={!matches.length} onClick={() => move(-1)}><ChevronDown className="size-4 rotate-180" /></Button>
    <Button type="button" size="icon-sm" variant="ghost" aria-label={t("next")} disabled={!matches.length} onClick={() => move(1)}><ChevronDown className="size-4" /></Button>
    <Input value={replacement} onChange={(event) => setReplacement(event.target.value)} className="h-8 min-w-40 flex-1" placeholder={t("replacement")} aria-label={t("replacement")} />
    <Button type="button" size="sm" variant="outline" disabled={!matches.length} onClick={() => replace(false)}><Replace className="size-3.5" />{t("replace")}</Button>
    <Button type="button" size="sm" variant="outline" disabled={!matches.length} onClick={() => replace(true)}>{t("replaceAll")}</Button>
    <Button type="button" size="icon-sm" variant="ghost" className="ml-auto" aria-label={t("close")} title={t("close")} onClick={() => onOpenChange(false)}><X className="size-4" /></Button>
  </div>;
}

function EditorOutlineNavigation({ editor, items, activePosition, onSelect }: { editor: Editor; items: OutlineItem[]; activePosition: number | null; onSelect?: () => void }) {
  const t = useTranslations("wiki.editor.outline");
  return <nav className="min-h-0 flex-1 overflow-y-auto p-3" aria-label={t("title")}>
    {items.length ? items.map((item) => <button key={`${item.position}-${item.id}`} type="button" className={cn("block w-full rounded-md py-1.5 pr-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-2", activePosition === item.position && "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300")} style={{ paddingLeft: `${0.5 + (item.level - 1) * 0.85}rem` }} onClick={() => {
      const heading = editor.view.nodeDOM(item.position) as HTMLElement | null;
      const top = heading?.getBoundingClientRect().top ?? 0;
      window.scrollBy({ top: top - 84, behavior: "smooth" });
      editor.chain().focus().setTextSelection(item.position + 1).run();
      onSelect?.();
    }}>{item.text || t("untitled")}</button>) : <p className="p-3 text-sm text-muted-foreground">{t("empty")}</p>}
  </nav>;
}

export function EditorOutlinePanel({ editor, items, activePosition, onClose }: { editor: Editor; items: OutlineItem[]; activePosition: number | null; onClose: () => void }) {
  const t = useTranslations("wiki.editor.outline");
  return <aside data-testid="editor-outline" className="sticky top-16 hidden max-h-[calc(100vh-5rem)] w-72 flex-col overflow-hidden rounded-xl border bg-background shadow-sm xl:flex">
    <header className="flex items-start gap-2 border-b p-3">
      <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">{t("title")}</h2><p className="mt-1 text-xs text-muted-foreground">{t("description")}</p></div>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={t("close")} title={t("close")} onClick={onClose}><X className="size-4" /></Button>
    </header>
    <EditorOutlineNavigation editor={editor} items={items} activePosition={activePosition} />
  </aside>;
}

export function EditorOutlineSheet({ editor, items, activePosition, open, onOpenChange }: { editor: Editor; items: OutlineItem[]; activePosition: number | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("wiki.editor.outline");
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent data-testid="editor-outline" side="right" className="w-[min(88vw,22rem)]">
      <SheetHeader className="border-b">
        <SheetTitle>{t("title")}</SheetTitle>
        <SheetDescription>{t("description")}</SheetDescription>
      </SheetHeader>
      <EditorOutlineNavigation editor={editor} items={items} activePosition={activePosition} onSelect={() => onOpenChange(false)} />
    </SheetContent>
  </Sheet>;
}
