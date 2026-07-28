"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CalendarClock,
  CalendarPlus,
  ClipboardPlus,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useFocusMode } from "@/components/focus-mode";
import { UserMenu } from "@/components/user-menu";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { moduleNav } from "@/modules/registry";
import { useTaskCreator } from "@/modules/tasks/components/task-create-provider";
import { useDeadlineCreator } from "@/modules/tasks/components/deadline-create-provider";
import { WorkspaceSearch } from "@/modules/context/components/workspace-search";

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  compact,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  compact: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      href={href}
      aria-label={compact ? label : undefined}
      onClick={onNavigate}
      className={cn(
        "flex h-10 items-center rounded-md text-sm font-medium transition-colors",
        compact ? "justify-center gap-0 px-0" : "gap-3 px-3",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
      )}
    >
      <Icon className="size-5" />
      <span
        aria-hidden={compact}
        className={cn(
          "min-w-0 truncate whitespace-nowrap transition-all duration-[220ms] ease-out motion-reduce:transition-none",
          compact ? "max-w-0 -translate-x-1 overflow-hidden opacity-0" : "max-w-44 translate-x-0 opacity-100",
        )}
      >
        {label}
      </span>
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

function AppNavigation({
  compact,
  pathname,
  userName,
  userEmail,
  onNavigate,
  navigationId,
  onOpenSearch,
}: {
  compact: boolean;
  pathname: string;
  userName: string;
  userEmail: string;
  onNavigate?: () => void;
  navigationId: string;
  onOpenSearch: () => void;
}) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tCalendar = useTranslations("calendar");
  const tTasks = useTranslations("tasks");
  const tDeadlines = useTranslations("deadlines");
  const { openTaskCreator } = useTaskCreator();
  const { openDeadlineCreator } = useDeadlineCreator();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <TooltipProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        <nav
          id={navigationId}
          aria-label={t("navigationLabel")}
          className={cn("flex flex-1 flex-col gap-1 overflow-y-auto", compact ? "px-2 py-3" : "p-3")}
        >
          <button
            type="button"
            onClick={() => {
              onOpenSearch();
              onNavigate?.();
            }}
            className={cn(
              "mb-2 flex h-10 items-center rounded-md border border-dashed text-sm font-medium text-muted-foreground transition-colors hover:border-indigo-300 hover:bg-indigo-50/60 hover:text-foreground dark:hover:bg-indigo-950/20",
              compact ? "justify-center px-0" : "gap-3 px-3",
            )}
            aria-label={tCommon("search")}
            title={`${tCommon("search")} · Ctrl+K`}
          >
            <Search className="size-5" />
            <span
              aria-hidden={compact}
              className={cn(
                "min-w-0 truncate whitespace-nowrap transition-all duration-[220ms]",
                compact
                  ? "max-w-0 overflow-hidden opacity-0"
                  : "max-w-44 opacity-100",
              )}
            >
              {tCommon("search")}
            </span>
            {!compact && (
              <kbd className="ml-auto rounded border bg-background px-1 py-0.5 text-[9px]">
                Ctrl K
              </kbd>
            )}
          </button>
          {moduleNav.map((item) => (
            <NavLink
              key={item.key}
              href={item.href}
              label={t(item.key)}
              icon={item.icon}
              active={isActive(item.href)}
              compact={compact}
              onNavigate={onNavigate}
            />
          ))}
          <div className="mt-auto flex flex-col gap-1">
            <NavLink
              href="/settings"
              label={t("settings")}
              icon={Settings}
              active={isActive("/settings")}
              compact={compact}
              onNavigate={onNavigate}
            />
            <div className="my-1 border-t" />
            <button
              type="button"
              onClick={() => {
                openTaskCreator();
                onNavigate?.();
              }}
              className={cn(
                "flex h-10 items-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                compact ? "justify-center gap-0 px-0" : "gap-3 px-3",
              )}
              aria-label={tTasks("quickAction")}
              title={tTasks("quickAction")}
            >
              <ClipboardPlus className="size-5" />
              <span aria-hidden={compact} className={cn("min-w-0 truncate whitespace-nowrap transition-all duration-[220ms] ease-out motion-reduce:transition-none", compact ? "max-w-0 -translate-x-1 overflow-hidden opacity-0" : "max-w-44 opacity-100")}>{tTasks("quickAction")}</span>
            </button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link
                    href="/calendar?new=event"
                    onClick={onNavigate}
                    aria-label={tCalendar("quickAction")}
                    title={tCalendar("quickAction")}
                    className={cn(
                      "flex h-10 items-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      compact ? "justify-center gap-0 px-0" : "gap-3 px-3",
                    )}
                  >
                    <CalendarPlus className="size-5" />
                    <span
                      aria-hidden={compact}
                      className={cn(
                        "min-w-0 truncate whitespace-nowrap transition-all duration-[220ms] ease-out motion-reduce:transition-none",
                        compact
                          ? "max-w-0 -translate-x-1 overflow-hidden opacity-0"
                          : "max-w-44 opacity-100",
                      )}
                    >
                      {tCalendar("quickAction")}
                    </span>
                  </Link>
                }
              />
              {compact && (
                <TooltipContent side="right" sideOffset={8}>
                  {tCalendar("quickAction")}
                </TooltipContent>
              )}
            </Tooltip>
            <button
              type="button"
              onClick={() => {
                openDeadlineCreator();
                onNavigate?.();
              }}
              className={cn(
                "flex h-10 items-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                compact ? "justify-center gap-0 px-0" : "gap-3 px-3",
              )}
              aria-label={tDeadlines("quickAction")}
              title={tDeadlines("quickAction")}
            >
              <CalendarClock className="size-5" />
              <span aria-hidden={compact} className={cn("min-w-0 truncate whitespace-nowrap transition-all duration-[220ms] ease-out motion-reduce:transition-none", compact ? "max-w-0 -translate-x-1 overflow-hidden opacity-0" : "max-w-44 opacity-100")}>{tDeadlines("quickAction")}</span>
            </button>
          </div>
        </nav>
        <div className={cn("border-t", compact ? "px-2 py-3" : "p-3")}>
          <UserMenu name={userName} email={userEmail} compact={compact} />
        </div>
      </div>
    </TooltipProvider>
  );
}

export function AppSidebar({ userName, userEmail }: { userName: string; userEmail: string }) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const { isFocused } = useFocusMode();
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    document.documentElement.style.setProperty("--app-rail-width", expanded ? "15rem" : "3.5rem");
    return () => { document.documentElement.style.removeProperty("--app-rail-width"); };
  }, [expanded]);

  if (isFocused) return null;

  return (
    <>
      <header data-testid="app-mobile-header" className="flex h-14 shrink-0 items-center gap-2 border-b bg-sidebar px-3 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("openNavigation")}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="size-5" />
        </Button>
        <Link href="/" className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          {tCommon("appName")}
        </Link>
        <UserMenu name={userName} email={userEmail} compact />
      </header>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          data-testid="app-navigation-sheet"
          side="left"
          showCloseButton={false}
          className="w-[min(20rem,88vw)] gap-0 p-0 md:hidden"
        >
          <SheetHeader className="flex-row items-center gap-2 border-b p-3 pr-2">
            <LayoutDashboard className="size-5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate">{tCommon("appName")}</SheetTitle>
              <SheetDescription className="sr-only">{t("navigationDescription")}</SheetDescription>
            </div>
            <SheetClose render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t("closeNavigation")} />}>
              <X className="size-4" />
            </SheetClose>
          </SheetHeader>
          <AppNavigation
            compact={false}
            navigationId="app-mobile-navigation"
            pathname={pathname}
            userName={userName}
            userEmail={userEmail}
            onNavigate={() => setMobileOpen(false)}
            onOpenSearch={() => setSearchOpen(true)}
          />
        </SheetContent>
      </Sheet>

      <aside
        data-testid="app-sidebar"
        data-expanded={expanded}
        className={cn(
          "app-rail-transition fixed inset-y-0 left-0 z-40 hidden h-dvh shrink-0 flex-col border-r bg-sidebar duration-[220ms] ease-out motion-reduce:transition-none md:flex",
          expanded ? "w-60" : "w-14",
        )}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocusCapture={() => setExpanded(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
        }}
      >
        <div className="flex h-14 shrink-0 items-center overflow-hidden border-b px-4">
          <Link
            href="/"
            aria-hidden={!expanded}
            tabIndex={expanded ? 0 : -1}
            className={cn(
              "truncate whitespace-nowrap text-base font-semibold tracking-tight transition-all duration-[220ms] ease-out motion-reduce:transition-none",
              expanded ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0",
            )}
          >
            {tCommon("appName")}
          </Link>
        </div>
        <AppNavigation
          compact={!expanded}
          navigationId="app-primary-navigation"
          pathname={pathname}
          userName={userName}
          userEmail={userEmail}
          onOpenSearch={() => setSearchOpen(true)}
        />
      </aside>
      <WorkspaceSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
