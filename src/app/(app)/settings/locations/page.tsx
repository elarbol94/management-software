import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { listAllBusinessLocations } from "@/modules/settings/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LocationsManager } from "./locations-manager";

export default async function LocationsSettingsPage() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/settings/company");
  const t = await getTranslations("settings.locations");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent><LocationsManager locations={listAllBusinessLocations()} /></CardContent>
    </Card>
  );
}
