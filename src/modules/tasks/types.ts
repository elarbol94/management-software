export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "open" | "done";
export type TaskKind = "task" | "deadline";
export type TaskContextType = "wikiPage" | "wikiSource" | "pdf" | "app";

export type TaskOrigin = {
  type: TaskContextType;
  entityId: string;
  route: string;
  label: string;
  anchor?: Record<string, unknown>;
};

export type EditableTask = {
  id: string;
  title: string;
  assigneeId: string | null;
  priority: TaskPriority;
  dueDate: string | null;
  status: TaskStatus;
  projectId: string | null;
};

export type ContextTaskMarker = {
  id: string;
  title: string;
  assigneeId: string | null;
  assigneeName: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
  route: string;
  label: string;
  anchorJson: string;
};

export type EditableDeadline = {
  id: string;
  title: string;
  description: string;
  assigneeId: string | null;
  deadlineAt: string;
  status: TaskStatus;
};

export type ContextDeadlineMarker = {
  id: string;
  title: string;
  description: string;
  assigneeId: string | null;
  assigneeName: string | null;
  deadlineAt: string;
  status: TaskStatus;
  route: string;
  label: string;
  anchorJson: string;
};
