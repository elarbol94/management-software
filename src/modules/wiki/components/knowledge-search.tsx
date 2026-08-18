"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BookOpen, FileText, LibraryBig, Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchResearch } from "../research-actions";
import { parseSearchSnippet } from "../lib/search-snippet";

type Results = Awaited<ReturnType<typeof searchResearch>>;

function Snippet({ value }: { value: string }) {
  return parseSearchSnippet(value).map((part, index) => part.highlighted
    ? <mark key={index} className="rounded-sm bg-amber-200 px-0.5 text-foreground dark:bg-amber-800/70">{part.text}</mark>
    : <span key={index}>{part.text}</span>);
}

export function KnowledgeSearch() {
  const t = useTranslations("wiki");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [searching, setSearching] = useState(false);
  const requestId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function update(value: string) {
    setQuery(value);
    const current = ++requestId.current;
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(() => {
      void searchResearch(value).then((next) => {
        if (requestId.current === current) setResults(next);
      }).finally(() => {
        if (requestId.current === current) setSearching(false);
      });
    }, 180);
  }

  const empty = results && !results.pages.length && !results.sources.length && !results.pdfPages.length;

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-4 left-4 size-5 text-muted-foreground" />
      <Input
        aria-label={t("searchEverything")}
        value={query}
        onChange={(event) => update(event.target.value)}
        placeholder={t("launchpadSearchPlaceholder")}
        className="h-13 rounded-xl bg-background pr-12 pl-12 text-base shadow-sm md:text-base"
      />
      {searching && <Loader2 className="absolute top-4 right-4 size-5 animate-spin text-indigo-500" />}
      {!searching && query && <button type="button" aria-label={t("clearResearchSearch")} onClick={() => update("")} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"><X className="size-5" /></button>}
      {results && (
        <div className="absolute top-[calc(100%+0.5rem)] right-0 left-0 z-40 max-h-[32rem] overflow-y-auto rounded-xl border bg-popover p-2 shadow-xl">
          {empty && <p className="p-4 text-center text-sm text-muted-foreground">{t("noResults")}</p>}
          {results.pages.length > 0 && <p className="px-2 py-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("documents")}</p>}
          {results.pages.map((item) => <Link key={item.id} href={`/wiki/pages/${item.slug}`} className="flex gap-3 rounded-lg p-2.5 hover:bg-accent"><FileText className="mt-0.5 size-4 shrink-0 text-indigo-500" /><span className="min-w-0"><span className="block text-sm font-medium">{item.title}</span><span className="block truncate text-xs text-muted-foreground"><Snippet value={item.snippet} /></span></span></Link>)}
          {results.pdfPages.length > 0 && <p className="mt-1 border-t px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("pdfPages")}</p>}
          {results.pdfPages.map((item) => <Link key={`${item.documentId}-${item.pageNumber}`} href={`/wiki/sources/${item.sourceId}/read/${item.documentId}?page=${item.pageNumber}`} className="flex gap-3 rounded-lg p-2.5 hover:bg-accent"><BookOpen className="mt-0.5 size-4 shrink-0 text-amber-600" /><span className="min-w-0"><span className="block text-sm font-medium">{item.sourceTitle} · {t("pageNumber", { page: item.pageNumber })}</span><span className="block truncate text-xs text-muted-foreground"><Snippet value={item.snippet} /></span></span></Link>)}
          {results.sources.length > 0 && <p className="mt-1 border-t px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("sources")}</p>}
          {results.sources.map((item) => <Link key={item.id} href={item.documentId ? `/wiki/sources/${item.id}/read/${item.documentId}` : `/wiki/sources/${item.id}`} className="flex gap-3 rounded-lg p-2.5 hover:bg-accent"><LibraryBig className="mt-0.5 size-4 shrink-0 text-emerald-600" /><span className="min-w-0"><span className="block text-sm font-medium">{item.title}</span><span className="block text-xs text-muted-foreground">{t(`sourceTypes.${item.type}`)} · {item.issuedDate || "—"}</span></span></Link>)}
        </div>
      )}
    </div>
  );
}
