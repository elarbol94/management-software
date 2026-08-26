"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BookOpen, FileText, Highlighter, LibraryBig, Search } from "lucide-react";
import type { SearchHit } from "../research-actions";
import { SearchSnippet } from "./search-snippet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const KINDS = ["all", "page", "source", "pdfPage", "annotation"] as const;

function KindIcon({ kind }: { kind: SearchHit["kind"] }) {
  if (kind === "page") return <FileText className="mt-0.5 size-4 shrink-0 text-indigo-500" />;
  if (kind === "source") return <LibraryBig className="mt-0.5 size-4 shrink-0 text-emerald-600" />;
  if (kind === "annotation") return <Highlighter className="mt-0.5 size-4 shrink-0 text-fuchsia-600" />;
  return <BookOpen className="mt-0.5 size-4 shrink-0 text-amber-600" />;
}

export function SearchResultsView({ query, kind, results }: {
  query: string;
  kind: string;
  results: SearchHit[];
}) {
  const t = useTranslations("wiki");
  const router = useRouter();
  const [draft, setDraft] = useState(query);

  function go(nextQuery: string, nextKind: string) {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextKind !== "all") params.set("kind", nextKind);
    router.push(`/wiki/search?${params.toString()}`);
  }

  const counts = new Map<string, number>();
  for (const hit of results) counts.set(hit.kind, (counts.get(hit.kind) ?? 0) + 1);
  const visible = kind === "all" ? results : results.filter((hit) => hit.kind === kind);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
      <h1 className="text-xl font-semibold">{t("searchResultsTitle")}</h1>

      <form
        className="relative"
        onSubmit={(event) => { event.preventDefault(); go(draft, kind); }}
      >
        <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
        <Input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t("searchResultsTitle")}
          placeholder={t("launchpadSearchPlaceholder")}
          className="h-11 pl-9"
        />
      </form>

      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((item) => {
          const count = item === "all" ? results.length : counts.get(item) ?? 0;
          return (
            <Button
              key={item}
              type="button"
              size="xs"
              variant={kind === item ? "secondary" : "outline"}
              aria-pressed={kind === item}
              onClick={() => go(query, item)}
            >
              {item === "all" ? t("searchKindAll") : t(`searchKinds.${item}`)}
              <span className="ml-1 text-muted-foreground tabular-nums">{count}</span>
            </Button>
          );
        })}
      </div>

      {!query ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("searchResultsEmptyQuery")}</p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("noResults")}</p>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {visible.map((hit) => (
            <Link key={hit.key} href={hit.href} className="flex gap-3 p-3 transition-colors hover:bg-accent">
              <KindIcon kind={hit.kind} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{hit.title}</span>
                  {"pageNumber" in hit && <span className="text-xs text-muted-foreground">{t("pageNumber", { page: hit.pageNumber })}</span>}
                  <span className="rounded border px-1 text-[9px] tracking-wide text-muted-foreground uppercase">{t(`searchKinds.${hit.kind}`)}</span>
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground"><SearchSnippet value={hit.snippet} /></span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
