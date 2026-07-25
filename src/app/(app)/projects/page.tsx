import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  getPortfolioSchedule,
  listProjects,
} from "@/modules/projects/queries";
import { PortfolioClient } from "@/modules/projects/components/portfolio-client";
import { ProjectFocusProvider } from "@/modules/projects/components/project-focus-mode";
import {
  projectFocusIdFromSearchParam,
  projectsFocusHref,
} from "@/modules/projects/focus";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  await requireUser();
  const query = await searchParams;
  const projects = listProjects({ includeArchived: true });
  const schedule = getPortfolioSchedule();
  const requestedFocusId = projectFocusIdFromSearchParam(query.focus);

  if (query.focus !== undefined && !requestedFocusId) redirect("/projects");
  if (
    requestedFocusId &&
    !schedule.tasks.some((task) => task.id === requestedFocusId)
  ) {
    redirect("/projects");
  }
  if (requestedFocusId && query.focus !== requestedFocusId) {
    redirect(projectsFocusHref(requestedFocusId));
  }

  return (
    <ProjectFocusProvider active={Boolean(requestedFocusId)}>
      <PortfolioClient
        projects={projects}
        schedule={schedule}
        initialFocusedTaskId={requestedFocusId}
      />
    </ProjectFocusProvider>
  );
}
