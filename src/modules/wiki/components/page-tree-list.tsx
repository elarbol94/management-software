"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Clock3, FileText, Search, UserRound } from "lucide-react";
import type { WorkspacePage } from "../research-queries";
import { parseTagList } from "../lib/tags";
import { buildPageTree } from "../lib/page-tree";
import { Input } from "@/components/ui/input";

export function PageTreeList({ pages }: { pages: WorkspacePage[] }) {
  const t = useTranslations("wiki");
  const format = useFormatter();
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const rows = useMemo(() => buildPageTree(pages), [pages]);
  const visible = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase(locale);
    if (!clean) return rows;
    // Filtering flattens the tree: a matching child without its parent must still be reachable.
    return rows
      .filter((row) =>
        [row.title, row.contentText, row.updatedByName, parseTagList(row.tags).map((tag) => tag.name).join(" ")]
          .some((value) => value.toLocaleLowerCase(locale).includes(clean)),
      )
      .map((row) => ({ ...row, depth: 0 }));
  }, [locale, query, rows]);

  if (pages.length === 0)
    return <div className="grid min-h-72 place-items-center rounded-xl border border-dashed bg-muted/20 text-center">
      <div>
        <FileText className="mx-auto mb-3 size-8 text-indigo-400" />
        <h2 className="font-medium">{t("noDocuments")}</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("noDocumentsDescription")}</p>
      </div>
    </div>;

  return <div className="space-y-4">
    <div className="relative">
      <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
      <Input aria-label={t("searchDocuments")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchDocuments")} className="pl-9" />
    </div>
    {visible.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t("noSearchResults")}</p> :
    <div className="divide-y rounded-xl border bg-card">{visible.map((row) => <div key={row.id} className="group flex flex-wrap items-center gap-x-3 gap-y-1 p-3 transition-colors hover:bg-indigo-50/60 dark:hover:bg-indigo-950/20" style={{ paddingLeft: `${12 + row.depth * 22}px` }}>
      <Link href={`/wiki/pages/${row.slug}`} className="flex min-w-0 flex-1 items-center gap-2">
        <FileText className="size-4 shrink-0 text-indigo-400" />
        <span className="truncate text-sm font-medium group-hover:text-indigo-700 dark:group-hover:text-indigo-300">{row.title}</span>
      </Link>
      {parseTagList(row.tags).map((tag) => <Link key={tag.id} href={`/wiki/tags/${tag.id}`} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-200 dark:hover:bg-indigo-900">{tag.name}</Link>)}
      <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">{t(`pageStatuses.${row.status}`)}</span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground"><UserRound className="size-3" />{row.updatedByName}</span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" />{format.dateTime(new Date(row.updatedAt), { dateStyle: "medium" })}</span>
    </div>)}</div>}
  </div>;
}
