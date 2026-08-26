"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BookOpen, Highlighter, FileText, LibraryBig, Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchResearch } from "../research-actions";
import { SearchSnippet } from "./search-snippet";

type Results = Awaited<ReturnType<typeof searchResearch>>;


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

  const empty = results && results.results.length === 0;

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
          {/* One ranked list across pages, sources, PDF pages and annotations. */}
          {results.results.map((item) => <Link key={item.key} href={item.href} className="flex gap-3 rounded-lg p-2.5 hover:bg-accent">
            {item.kind === "page" ? <FileText className="mt-0.5 size-4 shrink-0 text-indigo-500" />
              : item.kind === "source" ? <LibraryBig className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              : item.kind === "annotation" ? <Highlighter className="mt-0.5 size-4 shrink-0 text-fuchsia-600" />
              : <BookOpen className="mt-0.5 size-4 shrink-0 text-amber-600" />}
            <span className="min-w-0">
              <span className="block text-sm font-medium">{item.title}{"pageNumber" in item ? ` · ${t("pageNumber", { page: item.pageNumber })}` : ""}</span>
              <span className="block truncate text-xs text-muted-foreground"><SearchSnippet value={item.snippet} /></span>
            </span>
          </Link>)}
          {results.results.length > 0 && <Link href={`/wiki/search?q=${encodeURIComponent(query)}`} className="mt-1 block border-t px-2 pt-3 pb-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300">{t("showAllResults")}</Link>}
        </div>
      )}
    </div>
  );
}
