import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listUsers } from "@/modules/settings/queries";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateUserDialog } from "./create-user-dialog";

export default async function UsersSettingsPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "admin") redirect("/settings/profile");

  const users = listUsers();
  const t = await getTranslations("settings.users");

  return (
    <Card>
      <CardHeader className="flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <CreateUserDialog />
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:hidden">
          {users.map((user) => (
            <article key={user.id} className="rounded-xl border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{user.name}</h2>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{user.displayUsername ?? user.username}</p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                    {user.role === "admin" ? t("roleAdmin") : user.role === "personnel" ? t("rolePersonnel") : t("roleMember")}
                  </Badge>
                  {user.banned ? <Badge variant="destructive">{t("banned")}</Badge> : null}
                </div>
              </div>
              <p className="mt-3 break-all border-t pt-3 text-sm text-muted-foreground">{user.email}</p>
            </article>
          ))}
        </div>
        <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("username")}</TableHead>
              <TableHead>{t("email")}</TableHead>
              <TableHead>{t("role")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell>{user.displayUsername ?? user.username}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Badge
                      variant={user.role === "admin" ? "default" : "secondary"}
                    >
                      {user.role === "admin"
                        ? t("roleAdmin")
                        : user.role === "personnel"
                          ? t("rolePersonnel")
                          : t("roleMember")}
                    </Badge>
                    {user.banned && (
                      <Badge variant="destructive">{t("banned")}</Badge>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
  );
}
