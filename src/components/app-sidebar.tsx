"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutDashboard, Menu, Settings, X } from "lucide-react";
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
        compact ? "justify-center px-0" : "gap-3 px-3",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
      )}
    >
      <Icon className="size-5" />
      {!compact && <span className="truncate">{label}</span>}
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
}: {
  compact: boolean;
  pathname: string;
  userName: string;
  userEmail: string;
  onNavigate?: () => void;
  navigationId: string;
}) {
  const t = useTranslations("nav");
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
          />
        </SheetContent>
      </Sheet>

      <aside
        data-testid="app-sidebar"
        data-expanded={expanded}
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex",
          expanded ? "w-60" : "w-14",
        )}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocusCapture={() => setExpanded(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
        }}
      >
        {expanded ? (
          <div className="flex h-14 shrink-0 items-center border-b px-4">
            <Link href="/" className="truncate text-base font-semibold tracking-tight">
              {tCommon("appName")}
            </Link>
          </div>
        ) : (
          <div aria-hidden="true" className="h-14 shrink-0 border-b" />
        )}
        <AppNavigation
          compact={!expanded}
          navigationId="app-primary-navigation"
          pathname={pathname}
          userName={userName}
          userEmail={userEmail}
        />
      </aside>
    </>
  );
}
