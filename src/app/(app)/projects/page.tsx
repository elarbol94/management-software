import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { listProjects } from "@/modules/projects/queries";
import { ProjectsClient } from "@/modules/projects/components/projects-client";

export default async function ProjectsPage() {
  const [, t] = await Promise.all([
    requireUser(),
    getTranslations("projects"),
  ]);
  const projects = listProjects({ includeArchived: true });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <ProjectsClient projects={projects} />
    </div>
  );
}
