"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { Check, Globe, LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { setLocale } from "@/i18n/actions";
import { locales, type Locale } from "@/i18n/config";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ name, email, compact = false }: { name: string; email: string; compact?: boolean }) {
  const t = useTranslations("nav");
  const tLang = useTranslations("settings.language");
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const initials = name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function handleLogout() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={compact ? `${name} (${email})` : undefined}
        className={`flex items-center rounded-md text-left hover:bg-accent/50 ${compact ? "size-10 justify-center p-1" : "w-full gap-3 px-2 py-1.5"}`}
      >
        <Avatar className="size-8">
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        <div className={compact ? "hidden" : "min-w-0 flex-1"}>
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Globe className="mr-2 size-4" />
            {tLang("label")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {locales.map((code) => (
              <DropdownMenuItem
                key={code}
                onClick={() =>
                  startTransition(() => setLocale(code as Locale))
                }
              >
                {code === locale && <Check className="mr-2 size-4" />}
                <span className={code === locale ? "" : "ml-6"}>
                  {tLang(code)}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="mr-2 size-4" />
          {t("logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
