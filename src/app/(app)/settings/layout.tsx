import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { SettingsTabs } from "./settings-tabs";

export default async function SettingsLayout({
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
