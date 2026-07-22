import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBoard, getProject, listMembers } from "@/modules/projects/queries";
import { BoardClient } from "@/modules/projects/components/board-client";
import { EvidencePanel } from "@/modules/wiki/components/evidence-panel";

export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  await requireUser();
  const { projectId } = await params;
  const project = getProject(projectId);
  if (!project) notFound();

  const { columns, tasksByColumn } = getBoard(projectId);
  const members = listMembers();

  return (
    <div className="grid gap-6">
      <BoardClient
        project={project}
        columns={columns}
        tasksByColumn={tasksByColumn}
        members={members}
      />
      <EvidencePanel targetType="project" targetId={projectId} />
    </div>
  );
}
