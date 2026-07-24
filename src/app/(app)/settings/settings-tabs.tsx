"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function SettingsTabs({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations("settings.tabs");
  const pathname = usePathname();

  const tabs = [
    { href: "/settings/profile", label: t("profile") },
    ...(isAdmin
      ? [
          { href: "/settings/company", label: t("company") },
          { href: "/settings/categories", label: t("categories") },
          { href: "/settings/locations", label: t("locations") },
          { href: "/settings/users", label: t("users") },
        ]
      : []),
  ];

  return (
    <div className="flex gap-1 border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
            pathname.startsWith(tab.href)
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
