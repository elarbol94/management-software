"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Bell,
  BookOpen,
  FileText,
  House,
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
import { SearchSnippet } from "./search-snippet";

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
  const active = pathname === href || (href !== "/wiki" && href !== "/wiki/inbox" && pathname.startsWith(`${href}/`));
  const link = (
    <Link
      href={href}
      aria-label={compact ? label : undefined}
      onClick={onNavigate}
      className={cn(
        "relative flex h-10 items-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        compact ? "justify-center gap-0 px-0" : "gap-2 px-2",
        active && "bg-indigo-50 text-indigo-950 dark:bg-indigo-950/50 dark:text-indigo-100",
      )}
    >
      <Icon className="size-4" />
      <span
        aria-hidden={compact}
        className={cn(
          "min-w-0 flex-1 truncate whitespace-nowrap transition-all duration-[220ms] ease-out motion-reduce:transition-none",
          compact ? "max-w-0 -translate-x-1 overflow-hidden opacity-0" : "max-w-48 translate-x-0 opacity-100",
        )}
      >
        {label}
      </span>
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

export function ResearchSidebar({
  counts,
}: {
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
  const creatingRef = useRef(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequest = useRef(0);
  const desktopSearchRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);

  const createNote = useCallback(async () => {
    if (creating || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const note = await createQuickNote(locale === "en" ? "en" : "de");
      setMobileOpen(false);
      router.push(`/wiki/pages/${note.slug}`);
      router.refresh();
    } catch {
      toast.error(t("quickNoteFailed"));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, [creating, locale, router, t]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void createNote();
        return;
      }
      // Ctrl/Cmd+K focuses search from anywhere, the one binding every tool has and
      // this one lacked.
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
        const target = desktopSearchRef.current ?? mobileSearchRef.current;
        if (!target) return;
        event.preventDefault();
        target.focus();
        target.select();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [createNote]);

  useEffect(() => () => {
    searchRequest.current += 1;
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function updateSearch(value: string) {
    const request = ++searchRequest.current;
    setQuery(value);
    setSearchFailed(false);
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      void searchResearch(value)
        .then((next) => {
          if (searchRequest.current === request) {
            setResults(next);
            setSearchFailed(false);
          }
        })
        .catch(() => {
          if (searchRequest.current === request) {
            setResults(null);
            setSearchFailed(true);
          }
        })
        .finally(() => {
          if (searchRequest.current === request) setSearching(false);
        });
    }, 220);
  }

  function closeSearch(onNavigate?: () => void) {
    searchRequest.current += 1;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setQuery("");
    setResults(null);
    setSearching(false);
    setSearchFailed(false);
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
          aria-label={t("searchEverything")}
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
        {searching && (
          <div className="absolute top-12 right-3 left-3 z-50 rounded-lg border bg-popover p-3 text-xs text-muted-foreground shadow-xl">
            {t("loading")}
          </div>
        )}
        {!searching && searchFailed && (
          <div
            className="absolute top-12 right-3 left-3 z-50 grid justify-items-center gap-2 rounded-lg border bg-popover p-3 text-center text-xs text-destructive shadow-xl"
            role="alert"
          >
            <p>{t("researchSearchFailed")}</p>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => updateSearch(query)}
            >
              {t("retry")}
            </Button>
          </div>
        )}
        {!searching && !searchFailed && results && (
          <div className="absolute top-12 right-3 left-3 z-50 max-h-[28rem] overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl">
            {results.results.length === 0 && <p className="p-3 text-xs text-muted-foreground">{t("noResults")}</p>}
            {/* One ranked list across all four kinds: capped per-type sections hid a
                strong page hit behind weaker PDF hits. */}
            {results.results.map((item) => (
              <Link key={item.key} href={item.href} onClick={() => closeSearch(onNavigate)} className="block rounded-md px-2 py-1.5 hover:bg-accent">
                <span className="flex items-center gap-1.5">
                  <span className="rounded border px-1 text-[9px] tracking-wide text-muted-foreground uppercase">{t(`searchKinds.${item.kind}`)}</span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.title}{"pageNumber" in item ? ` · ${t("pageNumber", { page: item.pageNumber })}` : ""}</span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground"><SearchSnippet value={item.snippet} /></span>
              </Link>
            ))}
            {results.results.length > 0 && <Link href={`/wiki/search?q=${encodeURIComponent(query)}`} onClick={() => closeSearch(onNavigate)} className="mt-1 block border-t px-2 pt-2 pb-1 text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-300">{t("showAllResults")}</Link>}
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
            <div
              aria-hidden={compact}
              className={cn(
                "min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-all duration-[220ms] ease-out motion-reduce:transition-none",
                compact ? "max-w-0 -translate-x-1 opacity-0" : "max-w-48 translate-x-0 opacity-100",
              )}
            >
                <p className="text-sm font-semibold">{t("researchWorkspace")}</p>
                <p className="truncate text-[11px] text-muted-foreground">{t("sharedKnowledge")}</p>
            </div>
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

          {compact && !sheet ? (
            <div className="flex justify-center px-2 py-3">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={t("searchEverything")}
                      className="grid size-9 place-items-center rounded-md border border-transparent text-muted-foreground outline-none transition-colors hover:border-border hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-indigo-500"
                      onClick={() => {
                        setExpanded(true);
                        requestAnimationFrame(() => desktopSearchRef.current?.focus());
                      }}
                    />
                  }
                >
                  <Search className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="right">{t("searchEverything")}</TooltipContent>
              </Tooltip>
            </div>
          ) : searchBox({ id: searchId, inputRef, onNavigate })}

          <nav
            id={navigationId}
            aria-label={t("researchNavigationLabel")}
            className={cn("flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto", compact ? "p-2" : "p-3")}
          >
            <NavItem href="/wiki" icon={House} label={t("start")} compact={compact} onNavigate={onNavigate} />
            <NavItem href="/wiki/pages" icon={FileText} label={t("documents")} compact={compact} onNavigate={onNavigate} />
            <NavItem href="/wiki/sources" icon={LibraryBig} label={t("sources")} badge={counts.sources} compact={compact} onNavigate={onNavigate} />
            <div className="mt-2 border-t pt-2">
              {!compact && <p className="mb-1 px-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{t("more")}</p>}
              <NavItem href="/wiki/inbox" icon={Inbox} label={t("inbox")} badge={counts.inbox} compact={compact} onNavigate={onNavigate} />
              <NavItem href="/wiki/favorites" icon={Star} label={t("favorites")} compact={compact} onNavigate={onNavigate} />
              <NavItem href="/wiki/notifications" icon={Bell} label={t("notifications")} badge={counts.unread} compact={compact} onNavigate={onNavigate} />
              <NavItem href="/wiki/trash" icon={Trash2} label={t("trash")} badge={counts.trash} compact={compact} onNavigate={onNavigate} />
            </div>
          </nav>
        </div>
      </TooltipProvider>
    );
  }

  if (isFocused) return null;

  return (
    <>
      <header data-testid="research-mobile-header" className="flex h-14 shrink-0 items-center gap-2 border-b bg-sidebar px-3 md:hidden">
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
          "research-rail-transition fixed inset-y-0 left-[var(--app-rail-width,3.5rem)] z-30 hidden h-dvh shrink-0 flex-col border-r bg-sidebar duration-[220ms] ease-out motion-reduce:transition-none md:flex",
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
