import { requireUser } from "@/lib/auth";
import { getMyProfilePreferences, listMarkColorAvailability } from "@/modules/settings/queries";
import { MarkColorForm } from "./mark-color-form";

export default async function ProfileSettingsPage() {
  const currentUser = await requireUser();
  const preferences = getMyProfilePreferences(currentUser.id);
  const availability = listMarkColorAvailability(currentUser.id);
  return <MarkColorForm
    name={currentUser.name}
    currentColor={preferences.markColor}
    availability={availability}
  />;
}
