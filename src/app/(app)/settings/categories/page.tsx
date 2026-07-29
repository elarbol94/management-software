import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listCategories } from "@/modules/accounting/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CategoriesManager } from "./categories-manager";

export default async function CategoriesSettingsPage() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/settings/profile");

  const categories = listCategories({ includeArchived: true });
  const t = await getTranslations("settings.categories");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <CategoriesManager categories={categories} />
      </CardContent>
    </Card>
  );
}
