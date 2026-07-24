import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { SettingsTabs } from "./settings-tabs";

export const unstable_instant = {
  prefetch: "runtime",
  samples: [
    {
      cookies: [{ name: "locale", value: "de" }],
      headers: [["rsc", "1"], ["next-action", null]],
    },
  ],
};

async function SettingsChrome({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const t = await getTranslations("settings");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <SettingsTabs isAdmin={user.role === "admin"} />
      <div className="max-w-2xl">{children}</div>
    </div>
  );
}

export default function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <Suspense fallback={<div className="min-h-48" />}>
      <SettingsChrome>{children}</SettingsChrome>
    </Suspense>
  );
}
