import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  getFundingProjectControl,
  listFundingProgramTemplates,
} from "@/modules/funding/queries";
import { FundingProjectControlView } from "@/modules/funding/components/funding-project-control";

export default async function FundingProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  await requireUser();
  const { projectId } = await params;
  const control = getFundingProjectControl(projectId);
  if (!control) notFound();
  const templates = listFundingProgramTemplates();
  return <FundingProjectControlView control={control} templates={templates} />;
}
