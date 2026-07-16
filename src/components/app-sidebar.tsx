"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Settings } from "lucide-react";
import { moduleNav } from "@/modules/registry";
import { cn } from "@/lib/utils";

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}

export function AppSidebar({ userMenu }: { userMenu: React.ReactNode }) {
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/" className="text-base font-semibold tracking-tight">
          {tCommon("appName")}
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {moduleNav.map((item) => (
          <NavLink
            key={item.key}
            href={item.href}
            label={t(item.key)}
            icon={item.icon}
            active={isActive(item.href)}
          />
        ))}
        <div className="mt-auto flex flex-col gap-1">
          <NavLink
            href="/settings"
            label={t("settings")}
            icon={Settings}
            active={isActive("/settings")}
          />
        </div>
      </nav>
      <div className="border-t p-3">{userMenu}</div>
    </aside>
  );
}
