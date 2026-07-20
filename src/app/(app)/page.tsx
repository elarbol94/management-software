import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CalendarDays } from "@/components/server-safe-icons";
import { requireUser } from "@/lib/auth";
import { listMyTasks } from "@/modules/projects/queries";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function DashboardPage() {
  const user = await requireUser();
  const t = await getTranslations("dashboard");
  const tProjects = await getTranslations("projects");
  const format = await getFormatter();

  const myTasks = listMyTasks(user.id);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("welcome", { name: user.name })}
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{tProjects("myTasks")}</CardTitle>
        </CardHeader>
        <CardContent>
          {myTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {tProjects("noMyTasks")}
            </p>
          ) : (
            <div className="flex flex-col divide-y">
              {myTasks.map((task) => {
                const overdue = task.dueDate !== null && task.dueDate < today;
                return (
                  <Link
                    key={task.id}
                    href={`/projects/${task.projectId}`}
                    className="flex items-center gap-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <span
                      className="inline-block size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: task.projectColor }}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {task.title}
                    </span>
                    <Badge variant="outline">{task.columnName}</Badge>
                    {task.dueDate && (
                      <span
                        className={`flex items-center gap-1 text-xs ${
                          overdue
                            ? "font-medium text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        <CalendarDays className="size-3" />
                        {format.dateTime(new Date(task.dueDate), {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                        {overdue && ` · ${tProjects("overdue")}`}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
