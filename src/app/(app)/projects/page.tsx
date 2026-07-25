import { requireUser } from "@/lib/auth";
import {
  getPortfolioSchedule,
  listProjects,
} from "@/modules/projects/queries";
import { PortfolioClient } from "@/modules/projects/components/portfolio-client";

export default async function ProjectsPage() {
  await requireUser();
  const projects = listProjects({ includeArchived: true });
  const schedule = getPortfolioSchedule();

  return (
    <PortfolioClient projects={projects} schedule={schedule} />
  );
}
