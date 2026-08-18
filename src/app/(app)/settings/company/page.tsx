import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAppSettings } from "@/modules/settings/queries";
import { CompanyForm } from "./company-form";

export default async function CompanySettingsPage() {
  await connection();

  const user = await requireUser();
  if (user.role !== "admin") redirect("/settings/profile");

  const settings = getAppSettings();
  return <CompanyForm settings={settings} />;
}
