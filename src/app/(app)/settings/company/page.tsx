import { getAppSettings } from "@/modules/settings/queries";
import { CompanyForm } from "./company-form";

export default function CompanySettingsPage() {
  const settings = getAppSettings();
  return <CompanyForm settings={settings} />;
}
