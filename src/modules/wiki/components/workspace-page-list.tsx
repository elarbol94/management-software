"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  ChevronDown,
  Clock3,
  Inbox,
  Search,
  Star,
  UserRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { updatePageResearchMeta, toggleFavorite } from "../research-actions";
import type { WorkspacePage } from "../research-queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
const statuses = ["inbox", "working", "evergreen"] as const;
type Status = (typeof statuses)[number];
const tagsFor = (page: WorkspacePage) =>
  page.tags
    ?.split(",")
    .map((tag) => tag.trim())
    .filter(Boolean) ?? [];
export function WorkspacePageList({
  pages: initialPages,
}: {
  pages: WorkspacePage[];
}) {
  const t = useTranslations("wiki");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [pages, setPages] = useState(initialPages);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [evergreenOpen, setEvergreenOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setPages(initialPages));
    return () => cancelAnimationFrame(frame);
  }, [initialPages]);
  const tags = useMemo(
    () =>
      Array.from(new Set(pages.flatMap(tagsFor))).sort((a, b) =>
        a.localeCompare(b, locale),
      ),
    [locale, pages],
  );
  const visible = useMemo(() => {
    const clean = query.trim().toLocaleLowerCase(locale);
    return pages.filter(
      (page) =>
        (!clean ||
          [
            page.title,
            page.contentText,
            page.tags ?? "",
            page.updatedByName,
          ].some((value) => value.toLocaleLowerCase(locale).includes(clean))) &&
        (statusFilter === "all" || page.status === statusFilter) &&
        (tagFilter === "all" || tagsFor(page).includes(tagFilter)) &&
        (!favoritesOnly || page.favorite),
    );
  }, [favoritesOnly, locale, pages, query, statusFilter, tagFilter]);
  async function changeStatus(page: WorkspacePage, status: Status) {
    if (status === page.status) return;
    const previous = pages;
    setPendingId(page.id);
    setPages((current) =>
      current.map((item) => (item.id === page.id ? { ...item, status } : item)),
    );
    try {
      await updatePageResearchMeta({
        pageId: page.id,
        status,
        citationLocale: page.citationLocale,
        tagNames: tagsFor(page),
      });
      router.refresh();
    } catch {
      setPages(previous);
    } finally {
      setPendingId(null);
    }
  }
  async function changeFavorite(page: WorkspacePage) {
    const previous = pages;
    setPendingId(page.id);
    setPages((current) =>
      current.map((item) =>
        item.id === page.id ? { ...item, favorite: !item.favorite } : item,
      ),
    );
    try {
      await toggleFavorite("page", page.id);
      router.refresh();
    } catch {
      setPages(previous);
    } finally {
      setPendingId(null);
    }
  }
  const hasFilters = Boolean(
    query || statusFilter !== "all" || tagFilter !== "all" || favoritesOnly,
  );
  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setTagFilter("all");
    setFavoritesOnly(false);
  };
  if (pages.length === 0)
    return (
      <div className="grid min-h-72 place-items-center rounded-xl border border-dashed bg-muted/20 text-center">
        <div>
          <Inbox className="mx-auto mb-3 size-8 text-indigo-400" />
          <h2 className="font-medium">{t("inboxEmpty")}</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {t("inboxEmptyDescription")}
          </p>
        </div>
      </div>
    );
  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-3 shadow-xs">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchNotes")}
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter((value ?? "all") as Status | "all")
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allPageStatuses")}</SelectItem>
              {statuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`pageStatuses.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={tagFilter}
            onValueChange={(value) => setTagFilter(value ?? "all")}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allTags")}</SelectItem>
              {tags.map((tag) => (
                <SelectItem key={tag} value={tag}>
                  {tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={favoritesOnly ? "secondary" : "outline"}
            onClick={() => setFavoritesOnly((value) => !value)}
          >
            <Star
              className={cn(
                "size-4",
                favoritesOnly && "fill-indigo-400 text-indigo-500",
              )}
            />
            {t("favoritesOnly")}
          </Button>
        </div>
        {hasFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{t("activeFilters")}</span>
            {query && (
              <Button
                variant="secondary"
                size="xs"
                onClick={() => setQuery("")}
              >
                {query}
                <X />
              </Button>
            )}
            {statusFilter !== "all" && (
              <Button
                variant="secondary"
                size="xs"
                onClick={() => setStatusFilter("all")}
              >
                {t(`pageStatuses.${statusFilter}`)}
                <X />
              </Button>
            )}
            {tagFilter !== "all" && (
              <Button
                variant="secondary"
                size="xs"
                onClick={() => setTagFilter("all")}
              >
                {tagFilter}
                <X />
              </Button>
            )}
            {favoritesOnly && (
              <Button
                variant="secondary"
                size="xs"
                onClick={() => setFavoritesOnly(false)}
              >
                {t("favorites")}
                <X />
              </Button>
            )}
            <Button variant="ghost" size="xs" onClick={clearFilters}>
              {t("clearFilters")}
            </Button>
          </div>
        )}
      </div>
      {statuses
        .filter((status) => statusFilter === "all" || status === statusFilter)
        .map((status) => {
          const group = visible.filter((page) => page.status === status);
          const open =
            status !== "evergreen" ||
            evergreenOpen ||
            statusFilter === "evergreen";
          return (
            <section
              key={status}
              data-testid={`workspace-group-${status}`}
              className="overflow-hidden rounded-xl border bg-card"
            >
              <div className="flex items-center justify-between gap-3 bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="font-medium">{t(`pageStatuses.${status}`)}</h2>
                  <span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {group.length}
                  </span>
                </div>
                {status === "evergreen" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEvergreenOpen((value) => !value)}
                    aria-expanded={open}
                  >
                    <ChevronDown
                      className={cn(
                        "size-4 transition-transform",
                        open && "rotate-180",
                      )}
                    />
                    {open ? t("collapse") : t("expand")}
                  </Button>
                )}
              </div>
              {open && (
                <div className="divide-y">
                  {group.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">
                      {t("emptyStatusGroup")}
                    </p>
                  ) : (
                    group.map((page) => (
                      <article
                        key={page.id}
                        data-testid="workspace-note"
                        className="group grid gap-3 p-4 transition-colors hover:bg-indigo-50/60 md:grid-cols-[minmax(0,1fr)_auto] dark:hover:bg-indigo-950/20"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/wiki/pages/${page.slug}`}
                            className="block"
                          >
                            <h3 className="truncate font-medium group-hover:text-indigo-700 dark:group-hover:text-indigo-300">
                              {page.title}
                            </h3>
                            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                              {page.contentText || t("emptyNote")}
                            </p>
                          </Link>
                          {tagsFor(page).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {tagsFor(page).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock3 className="size-3" />
                              {format.dateTime(new Date(page.updatedAt), {
                                dateStyle: "medium",
                              })}
                            </span>
                            <span className="flex items-center gap-1">
                              <UserRound className="size-3" />
                              {page.updatedByName}
                            </span>
                          </p>
                        </div>
                        <div className="flex items-start gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <Button
                            data-testid="workspace-note-favorite"
                            variant="ghost"
                            size="icon-sm"
                            disabled={pendingId === page.id}
                            onClick={() => void changeFavorite(page)}
                            title={t("favorite")}
                          >
                            <Star
                              className={cn(
                                "size-4",
                                page.favorite &&
                                  "fill-indigo-400 text-indigo-500",
                              )}
                            />
                          </Button>
                          <Select
                            value={page.status}
                            onValueChange={(value) =>
                              void changeStatus(page, value as Status)
                            }
                            disabled={pendingId === page.id}
                          >
                            <SelectTrigger
                              data-testid="workspace-note-status"
                              className="w-32"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {statuses.map((item) => (
                                <SelectItem key={item} value={item}>
                                  {t(`pageStatuses.${item}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              )}
            </section>
          );
        })}
    </div>
  );
}
