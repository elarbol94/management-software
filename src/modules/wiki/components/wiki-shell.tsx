"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  ChevronRight,
  FileText,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  createPage,
  deletePage,
  renamePage,
  searchWiki,
} from "@/modules/wiki/actions";
import type { WikiTreeNode, WikiSearchResult } from "@/modules/wiki/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WikiEditor } from "./wiki-editor";

type PageDto = { id: string; title: string; slug: string; contentJson: string };
type PageRef = { id: string; title: string; slug: string };

function TreeNode({
  node,
  activeSlug,
  depth,
  onAddChild,
  onRename,
  onDelete,
}: {
  node: WikiTreeNode;
  activeSlug: string;
  depth: number;
  onAddChild: (parentId: string) => void;
  onRename: (node: WikiTreeNode) => void;
  onDelete: (node: WikiTreeNode) => void;
}) {
  const t = useTranslations("wiki");
  const [expanded, setExpanded] = useState(true);
  const active = node.slug === activeSlug;

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded-md py-1 pr-1 text-sm ${
          active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
          >
            <ChevronRight
              className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Link href={`/wiki/${node.slug}`} className="min-w-0 flex-1 truncate">
          {node.icon ? `${node.icon} ` : ""}
          {node.title}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 data-popup-open:opacity-100"
              />
            }
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onAddChild(node.id)}>
              <Plus className="mr-2 size-4" />
              {t("newSubpage")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRename(node)}>
              <Pencil className="mr-2 size-4" />
              {t("rename")}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(node)}>
              <Trash2 className="mr-2 size-4" />
              {t("deletePage")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {expanded &&
        node.children.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            activeSlug={activeSlug}
            depth={depth + 1}
            onAddChild={onAddChild}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
    </div>
  );
}

export function WikiShell({
  page,
  tree,
  backlinks,
  allPages,
  meta,
}: {
  page: PageDto;
  tree: WikiTreeNode[];
  backlinks: PageRef[];
  allPages: PageRef[];
  meta: { updatedAt: number; updatedByName: string } | null;
}) {
  const t = useTranslations("wiki");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WikiSearchResult[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onQueryChange(value: string) {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) {
      setResults(null);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        setResults(await searchWiki(value));
      } catch {
        setResults([]);
      }
    }, 250);
  }

  async function onAddPage(parentId: string | null) {
    const title = window.prompt(t("pageTitle"));
    if (!title?.trim()) return;
    const { slug } = await createPage({ title: title.trim(), parentId });
    router.push(`/wiki/${slug}`);
    router.refresh();
  }

  async function onRename(node: PageRef) {
    const title = window.prompt(t("pageTitle"), node.title);
    if (!title?.trim()) return;
    await renamePage(node.id, title.trim());
    router.refresh();
  }

  async function onDelete(node: PageRef) {
    if (!window.confirm(tCommon("confirmDeleteTitle"))) return;
    await deletePage(node.id);
    if (node.id === page.id) router.push("/wiki");
    router.refresh();
  }

  return (
    <div className="flex h-full gap-6">
      <aside className="flex w-64 shrink-0 flex-col gap-3">
        <div className="relative">
          <Search className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-8"
          />
          {results !== null && (
            <div className="absolute top-full right-0 left-0 z-20 mt-1 flex flex-col overflow-hidden rounded-md border bg-popover shadow-md">
              {results.length === 0 && (
                <span className="px-3 py-2 text-sm text-muted-foreground">
                  {t("noResults")}
                </span>
              )}
              {results.map((result) => (
                <Link
                  key={result.pageId}
                  href={`/wiki/${result.slug}`}
                  onClick={() => setQuery("")}
                  className="flex flex-col gap-0.5 px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className="font-medium">{result.title}</span>
                  <span
                    className="truncate text-xs text-muted-foreground [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:text-foreground"
                    dangerouslySetInnerHTML={{ __html: result.snippet }}
                  />
                </Link>
              ))}
            </div>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onAddPage(null)}
        >
          <Plus className="size-4" />
          {t("newPage")}
        </Button>

        <nav className="flex flex-col gap-0.5 overflow-y-auto">
          {tree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              activeSlug={page.slug}
              depth={0}
              onAddChild={(parentId) => onAddPage(parentId)}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <h1
            className="cursor-pointer text-2xl font-semibold tracking-tight"
            title={t("rename")}
            onClick={() => onRename(page)}
          >
            {page.title}
          </h1>
          {meta && (
            <span className="pt-2 text-xs whitespace-nowrap text-muted-foreground">
              {t("lastEdited", { name: meta.updatedByName })} ·{" "}
              {format.dateTime(new Date(meta.updatedAt), {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>

        <WikiEditor
          key={page.id}
          pageId={page.id}
          initialContent={page.contentJson}
          allPages={allPages.filter((p) => p.id !== page.id)}
        />

        {backlinks.length > 0 && (
          <div className="mt-4 flex flex-col gap-2 border-t pt-4">
            <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Link2 className="size-4" />
              {t("backlinks")}
            </h2>
            <div className="flex flex-wrap gap-2">
              {backlinks.map((backlink) => (
                <Link
                  key={backlink.id}
                  href={`/wiki/${backlink.slug}`}
                  className="rounded-md border px-2 py-1 text-sm hover:bg-accent"
                >
                  {backlink.title}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
