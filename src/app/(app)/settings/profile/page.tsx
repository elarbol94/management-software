import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import {
  getMyProfilePreferences,
  listMarkColorAvailability,
} from "@/modules/settings/queries";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InviteUserDialog } from "../users/invite-user-dialog";
import { MarkColorForm } from "./mark-color-form";

export default async function ProfileSettingsPage() {
  const currentUser = await requireUser();
  const preferences = getMyProfilePreferences(currentUser.id);
  const availability = listMarkColorAvailability(currentUser.id);
  const t = await getTranslations("settings.users");

  return (
    <div className="flex flex-col gap-6">
      {currentUser.role === "admin" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("accessDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <InviteUserDialog />
            <Button
              nativeButton={false}
              variant="outline"
              size="sm"
              render={<Link href="/settings/users" />}
            >
              {t("manageUsers")}
            </Button>
          </CardContent>
        </Card>
      )}
      <MarkColorForm
        name={currentUser.name}
        currentColor={preferences.markColor}
        availability={availability}
      />
    </div>
  );
}
