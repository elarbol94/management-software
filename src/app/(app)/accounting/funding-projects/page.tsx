import { requireUser } from "@/lib/auth";
import {
  listFundingProgramTemplates,
  listFundingProjects,
} from "@/modules/funding/queries";
import { FundingProjectsClient } from "@/modules/funding/components/funding-projects-client";

export default async function FundingProjectsPage() {
  await requireUser();
  const projects = listFundingProjects();
  const templates = listFundingProgramTemplates();
  return <FundingProjectsClient projects={projects} templates={templates} />;
}
