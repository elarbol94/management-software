"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArchiveRestore,
  Bell,
  BookOpen,
  ChevronRight,
  FileText,
  Hash,
  Inbox,
  LibraryBig,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFocusMode } from "@/components/focus-mode";
import { cn } from "@/lib/utils";
import { createQuickNote, searchResearch } from "../research-actions";
import type { WikiTreeNode } from "../queries";
import type { TagDto } from "../research-queries";

type SearchResults = Awaited<ReturnType<typeof searchResearch>>;

function NavItem({
  href,
  icon: Icon,
  label,
  badge,
  compact,
  onNavigate,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
  compact: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/wiki/inbox" && pathname.startsWith(`${href}/`));
  const link = (
    <Link
      href={href}
      aria-label={compact ? label : undefined}
      onClick={onNavigate}
      className={cn(
        "relative flex h-10 items-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        compact ? "justify-center px-0" : "gap-2 px-2",
        active && "bg-indigo-50 text-indigo-950 dark:bg-indigo-950/50 dark:text-indigo-100",
      )}
    >
      <Icon className="size-4" />
      {!compact && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!!badge && (
        <span className={cn(
          "rounded-full bg-indigo-100 text-[10px] tabular-nums text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
          compact ? "absolute top-0.5 right-0.5 min-w-4 px-1 text-center" : "px-1.5",
        )}>
          {badge}
        </span>
      )}
    </Link>
  );

  if (!compact) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  );
}

function PageTree({
  nodes,
  depth = 0,
  onNavigate,
}: {
  nodes: WikiTreeNode[];
  depth?: number;
  onNavigate?: () => void;
}) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  return <>{nodes.map((node) => (
    <div key={node.id}>
      <div className="flex items-center" style={{ paddingLeft: `${depth * 10}px` }}>
        {node.children.length ? (
          <button
            type="button"
            className="grid size-5 place-items-center text-muted-foreground"
            aria-expanded={!closed[node.id]}
            onClick={() => setClosed((value) => ({ ...value, [node.id]: !value[node.id] }))}
          >
            <ChevronRight className={cn("size-3 transition-transform", !closed[node.id] && "rotate-90")} />
          </button>
        ) : <span className="w-5" />}
        <Link
          href={`/wiki/pages/${node.slug}`}
          onClick={onNavigate}
          className="min-w-0 flex-1 truncate rounded px-1 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {node.icon ? `${node.icon} ` : ""}{node.title}
        </Link>
      </div>
      {!closed[node.id] && <PageTree nodes={node.children} depth={depth + 1} onNavigate={onNavigate} />}
    </div>
  ))}</>;
}

export function ResearchSidebar({
  tree,
  tags,
  counts,
}: {
  tree: WikiTreeNode[];
  tags: TagDto[];
  counts: { inbox: number; sources: number; unread: number; trash: number };
}) {
  const t = useTranslations("wiki");
  const locale = useLocale();
  const router = useRouter();
  const { isFocused } = useFocusMode();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    document.documentElement.style.setProperty("--research-rail-width", expanded ? "16rem" : "3.5rem");
    return () => { document.documentElement.style.removeProperty("--research-rail-width"); };
  }, [expanded]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const desktopSearchRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createNote();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (window.matchMedia("(min-width: 768px)").matches) openDesktopSearch();
        else openMobileSearch();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function createNote() {
    setCreating(true);
    try {
      const note = await createQuickNote(locale === "en" ? "en" : "de");
      setMobileOpen(false);
      router.push(`/wiki/pages/${note.slug}`);
      router.refresh();
    } finally {
      setCreating(false);
    }
  }

  function focusAfterLayout(ref: React.RefObject<HTMLInputElement | null>) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => ref.current?.focus());
    });
  }

  function openDesktopSearch() {
    setExpanded(true);
    focusAfterLayout(desktopSearchRef);
  }

  function openMobileSearch() {
    setMobileOpen(true);
    focusAfterLayout(mobileSearchRef);
  }

  function updateSearch(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setResults(null);
      return;
    }
    timer.current = setTimeout(async () => setResults(await searchResearch(value)), 220);
  }

  function closeSearch(onNavigate?: () => void) {
    setQuery("");
    setResults(null);
    onNavigate?.();
  }

  function searchBox({
    id,
    inputRef,
    onNavigate,
  }: {
    id: string;
    inputRef: React.RefObject<HTMLInputElement | null>;
    onNavigate?: () => void;
  }) {
    return (
      <div className="relative p-3 pb-1">
        <Search className="absolute top-5 left-5 size-3.5 text-muted-foreground" />
        <Input
          ref={inputRef}
          id={id}
          value={query}
          onChange={(event) => updateSearch(event.target.value)}
          placeholder={t("searchEverything")}
          className="h-8 bg-background pr-7 pl-7 text-xs"
        />
        {query && (
          <button
            type="button"
            aria-label={t("clearResearchSearch")}
            className="absolute top-5 right-5 text-muted-foreground"
            onClick={() => closeSearch()}
          >
            <X className="size-3.5" />
          </button>
        )}
        {results && (
          <div className="absolute top-12 right-3 left-3 z-50 max-h-[28rem] overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl">
            {results.pages.length === 0 && results.sources.length === 0 && results.pdfPages.length === 0 && <p className="p-3 text-xs text-muted-foreground">{t("noResults")}</p>}
            {results.pages.length > 0 && <p className="px-2 py-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{t("pages")}</p>}
            {results.pages.map((item) => (
              <Link key={item.id} href={`/wiki/pages/${item.slug}`} onClick={() => closeSearch(onNavigate)} className="block rounded-md px-2 py-1.5 hover:bg-accent">
                <span className="block text-xs font-medium">{item.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground" dangerouslySetInnerHTML={{ __html: item.snippet }} />
              </Link>
            ))}
            {results.pdfPages.length > 0 && <p className="mt-1 border-t px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{t("pdfPages")}</p>}
            {results.pdfPages.map((item) => (
              <Link key={`${item.sourceId}-${item.pageNumber}`} href={`/wiki/sources/${item.sourceId}/read/${item.documentId}?page=${item.pageNumber}`} onClick={() => closeSearch(onNavigate)} className="block rounded-md px-2 py-1.5 hover:bg-accent">
                <span className="block text-xs font-medium">{item.sourceTitle} · {t("pageNumber", { page: item.pageNumber })}</span>
                <span className="block truncate text-[11px] text-muted-foreground" dangerouslySetInnerHTML={{ __html: item.snippet }} />
              </Link>
            ))}
            {results.sources.length > 0 && <p className="mt-1 border-t px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{t("sources")}</p>}
            {results.sources.map((item) => (
              <Link key={item.id} href={`/wiki/sources/${item.id}`} onClick={() => closeSearch(onNavigate)} className="block rounded-md px-2 py-1.5 hover:bg-accent">
                <span className="block text-xs font-medium">{item.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{item.type} · {item.issuedDate || "—"}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  function sidebarContent({
    compact,
    inputRef,
    searchId,
    navigationId,
    onNavigate,
    sheet = false,
  }: {
    compact: boolean;
    inputRef: React.RefObject<HTMLInputElement | null>;
    searchId: string;
    navigationId: string;
    onNavigate?: () => void;
    sheet?: boolean;
  }) {
    return (
      <TooltipProvider>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn("flex h-14 shrink-0 items-center border-b", compact ? "flex-col gap-2 px-2 py-3" : "gap-2 p-3")}>
            <div className="grid size-8 shrink-0 place-items-center rounded-md bg-indigo-600 text-white">
              <BookOpen className="size-4" />
            </div>
            {!compact && (
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t("researchWorkspace")}</p>
                <p className="truncate text-[11px] text-muted-foreground">{t("sharedKnowledge")}</p>
              </div>
            )}
            {(!compact || sheet) && (
              <Button
                type="button"
                variant={compact ? "ghost" : "default"}
                size="icon-sm"
                onClick={createNote}
                disabled={creating}
                aria-label={t("quickNote")}
                title={t("quickNote")}
              >
                <Plus className="size-4" />
              </Button>
            )}
            {sheet && (
              <SheetClose render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t("closeResearchNavigation")} />}>
                <X className="size-4" />
              </SheetClose>
            )}
          </div>

          {compact ? (
            <div className="p-2 pb-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("searchEverything")}
                      onClick={openDesktopSearch}
                      className="w-full"
                    />
                  }
                >
                  <Search className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>{t("searchEverything")}</TooltipContent>
              </Tooltip>
            </div>
          ) : searchBox({ id: searchId, inputRef, onNavigate })}

          <nav
            id={navigationId}
            aria-label={t("researchNavigationLabel")}
            className={cn("flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto", compact ? "p-2" : "p-3")}
          >
            <NavItem href="/wiki/inbox" icon={Inbox} label={t("inbox")} badge={counts.inbox} compact={compact} onNavigate={onNavigate} />
            <NavItem href="/wiki/pages" icon={FileText} label={t("pages")} compact={compact} onNavigate={onNavigate} />
            <NavItem href="/wiki/sources" icon={LibraryBig} label={t("sources")} badge={counts.sources} compact={compact} onNavigate={onNavigate} />
            <NavItem href="/wiki/favorites" icon={Star} label={t("favorites")} compact={compact} onNavigate={onNavigate} />
            <NavItem href="/wiki/notifications" icon={Bell} label={t("notifications")} badge={counts.unread} compact={compact} onNavigate={onNavigate} />
            <NavItem href="/wiki/trash" icon={Trash2} label={t("trash")} badge={counts.trash} compact={compact} onNavigate={onNavigate} />

            {!compact && (
              <div className="mt-3 border-t pt-3">
                <p className="mb-1 flex items-center gap-1 px-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  <ArchiveRestore className="size-3" />{t("pageTree")}
                </p>
                <PageTree nodes={tree} onNavigate={onNavigate} />
              </div>
            )}
            {!compact && tags.length > 0 && (
              <div className="mt-3 border-t pt-3">
                <p className="mb-1 flex items-center gap-1 px-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  <Hash className="size-3" />{t("tags")}
                </p>
                {tags.map((tag) => (
                  <Link key={tag.id} href={`/wiki/tags/${tag.id}`} onClick={onNavigate} className="flex items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                    <span className="size-1.5 rounded-full bg-indigo-500" />{tag.name}
                  </Link>
                ))}
              </div>
            )}
          </nav>
        </div>
      </TooltipProvider>
    );
  }

  if (isFocused) return null;

  return (
    <>
      <header data-testid="research-mobile-header" className="flex h-14 shrink-0 items-center gap-2 border-b bg-[linear-gradient(90deg,rgba(79,70,229,0.07),transparent)] px-3 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("openResearchNavigation")}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
          className="bg-indigo-600 text-white hover:bg-indigo-500 hover:text-white"
        >
          <BookOpen className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{t("researchWorkspace")}</p>
          <p className="truncate text-[11px] text-muted-foreground">{t("sharedKnowledge")}</p>
        </div>
        <Button type="button" size="icon-sm" onClick={createNote} disabled={creating} aria-label={t("quickNote")} title={t("quickNote")}>
          <Plus className="size-4" />
        </Button>
      </header>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          data-testid="research-navigation-sheet"
          side="left"
          showCloseButton={false}
          className="w-[min(22rem,90vw)] gap-0 p-0 md:hidden"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{t("researchWorkspace")}</SheetTitle>
            <SheetDescription>{t("researchNavigationDescription")}</SheetDescription>
          </SheetHeader>
          {sidebarContent({
            compact: false,
            inputRef: mobileSearchRef,
            searchId: "research-search-mobile",
            navigationId: "research-mobile-navigation",
            onNavigate: () => setMobileOpen(false),
            sheet: true,
          })}
        </SheetContent>
      </Sheet>

      <aside
        data-testid="research-sidebar"
        data-expanded={expanded}
        className={cn(
          "fixed inset-y-0 left-[var(--app-rail-width,3.5rem)] z-30 hidden h-dvh shrink-0 flex-col border-r bg-[linear-gradient(180deg,rgba(79,70,229,0.045),transparent_14rem)] transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex",
          expanded ? "w-64" : "w-14",
        )}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocusCapture={() => setExpanded(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
        }}
      >
        {sidebarContent({
          compact: !expanded,
          inputRef: desktopSearchRef,
          searchId: "research-search-desktop",
          navigationId: "research-primary-navigation",
        })}
      </aside>
    </>
  );
}
