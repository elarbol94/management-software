"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BookOpenText,
  CalendarRange,
  FileText,
  HandCoins,
  LayoutDashboard,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { key: "overview", href: "/accounting", icon: LayoutDashboard, exact: true },
  { key: "bookings", href: "/accounting/bookings", icon: BookOpenText },
  { key: "invoices", href: "/accounting/invoices", icon: FileText },
  { key: "planning", href: "/accounting/planning", icon: CalendarRange },
  { key: "funding", href: "/accounting/funding-projects", icon: HandCoins },
] as const;

export function AccountingNav() {
  const pathname = usePathname();
  const t = useTranslations("accountingShell");

  return (
    <nav aria-label={t("navigationLabel")} className="overflow-x-auto">
      <div className="flex min-w-max gap-1">
        {items.map((item) => {
          const active = "exact" in item && item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex h-11 items-center gap-2 px-3 text-sm font-medium text-[#61706b] transition-colors hover:text-[#173c32] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#315c73] focus-visible:ring-offset-2",
                active && "text-[#173c32]",
              )}
            >
              <Icon
                className={cn(
                  "size-4 text-[#87938f] transition-colors group-hover:text-[#315c73]",
                  active && "text-[#315c73]",
                )}
              />
              {t(item.key)}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-3 bottom-0 h-0.5 origin-left scale-x-0 rounded-full bg-[#315c73] transition-transform",
                  active && "scale-x-100",
                )}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
