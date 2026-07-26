import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBoard, getPortfolioSchedule, getProject, listMembers } from "@/modules/projects/queries";
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

  const { columns, tasksByColumn, subtasksByParent } = getBoard(projectId);
  const members = listMembers();
  const schedule = getPortfolioSchedule();
  const predecessorOptions = [
    ...schedule.projects.map((project) => ({ id: project.id, title: project.name, dueDate: project.targetEndDate, type: "project" as const })),
    ...schedule.tasks.map((task) => ({ id: task.id, title: task.title, dueDate: task.dueDate, type: "task" as const })),
  ];

  return (
    <div className="grid min-w-0 gap-6">
      <BoardClient
        project={project}
        columns={columns}
        tasksByColumn={tasksByColumn}
        subtasksByParent={subtasksByParent}
        members={members}
        predecessorOptions={predecessorOptions}
      />
      <EvidencePanel targetType="project" targetId={projectId} />
    </div>
  );
}
