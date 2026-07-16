import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBoard, getProject, listMembers } from "@/modules/projects/queries";
import { BoardClient } from "@/modules/projects/components/board-client";

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
    <BoardClient
      project={project}
      columns={columns}
      tasksByColumn={tasksByColumn}
      members={members}
    />
  );
}
