import {
  addCalendarDays,
  dueDateForDuration,
} from "@/modules/projects/schedule";

export const PROJECTS_PATH = "/projects";
export const PROJECT_FOCUS_PARAM = "focus";

export type FocusTask = {
  id: string;
  parentTaskId?: string | null;
  startDate: string | null;
  dueDate: string | null;
};

export type FocusDependency = {
  predecessorTaskId: string;
  successorTaskId: string;
};

export type FocusedTaskSubtree<T extends FocusTask> = {
  root: T;
  tasks: T[];
  taskIds: string[];
  ancestors: T[];
  depthByTaskId: Record<string, number>;
};

export type FocusDateRange = {
  startDate: string;
  dueDate: string;
  isFallback: boolean;
};

export type FocusDependencyClassification<T extends FocusDependency> = {
  internal: T[];
  incomingExternal: T[];
  outgoingExternal: T[];
};

export function projectFocusIdFromSearchParam(
  value: string | string[] | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const taskId = value.trim();
  return taskId.length > 0 ? taskId : null;
}

export function projectsFocusHref(taskId?: string | null): string {
  const normalizedTaskId = taskId?.trim();
  if (!normalizedTaskId) return PROJECTS_PATH;
  return `${PROJECTS_PATH}?${PROJECT_FOCUS_PARAM}=${encodeURIComponent(normalizedTaskId)}`;
}

export function resolveFocusedTaskSubtree<T extends FocusTask>(
  tasks: T[],
  taskId: string,
): FocusedTaskSubtree<T> | null {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const root = byId.get(taskId);
  if (!root) return null;

  const childrenByParent = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.parentTaskId) continue;
    const children = childrenByParent.get(task.parentTaskId) ?? [];
    children.push(task);
    childrenByParent.set(task.parentTaskId, children);
  }

  const subtreeTasks: T[] = [];
  const depthByTaskId: Record<string, number> = {};
  const seen = new Set<string>();
  const visit = (task: T, depth: number) => {
    if (seen.has(task.id)) throw new Error("Task hierarchy cycle");
    seen.add(task.id);
    subtreeTasks.push(task);
    depthByTaskId[task.id] = depth;
    for (const child of childrenByParent.get(task.id) ?? []) visit(child, depth + 1);
  };
  visit(root, 0);

  const ancestors: T[] = [];
  const ancestorIds = new Set<string>([root.id]);
  let cursor = root;
  while (cursor.parentTaskId) {
    if (ancestorIds.has(cursor.parentTaskId)) throw new Error("Task hierarchy cycle");
    ancestorIds.add(cursor.parentTaskId);
    const parent = byId.get(cursor.parentTaskId);
    if (!parent) break;
    ancestors.unshift(parent);
    cursor = parent;
  }

  return {
    root,
    tasks: subtreeTasks,
    taskIds: subtreeTasks.map((task) => task.id),
    ancestors,
    depthByTaskId,
  };
}

export function focusDateRange(
  tasks: FocusTask[],
  today: string,
  options: { paddingDays?: number; fallbackDays?: number } = {},
): FocusDateRange {
  const paddingDays = Math.max(0, Math.round(options.paddingDays ?? 5));
  const fallbackDays = Math.max(1, Math.round(options.fallbackDays ?? 20));
  const starts = tasks
    .map((task) => task.startDate ?? task.dueDate)
    .filter((value): value is string => Boolean(value))
    .sort();
  const finishes = tasks
    .map((task) => task.dueDate ?? task.startDate)
    .filter((value): value is string => Boolean(value))
    .sort();

  if (starts.length > 0 && finishes.length > 0) {
    return {
      startDate: addCalendarDays(starts[0], -paddingDays),
      dueDate: addCalendarDays(finishes.at(-1)!, paddingDays),
      isFallback: false,
    };
  }

  const daysBeforeToday = Math.floor(fallbackDays / 2);
  const startDate = addCalendarDays(today, -daysBeforeToday);
  return {
    startDate,
    dueDate: dueDateForDuration(startDate, fallbackDays),
    isFallback: true,
  };
}

export function classifyFocusDependencies<T extends FocusDependency>(
  dependencies: T[],
  focusedTaskIds: Iterable<string>,
): FocusDependencyClassification<T> {
  const focused = new Set(focusedTaskIds);
  const result: FocusDependencyClassification<T> = {
    internal: [],
    incomingExternal: [],
    outgoingExternal: [],
  };

  for (const dependency of dependencies) {
    const predecessorIsFocused = focused.has(dependency.predecessorTaskId);
    const successorIsFocused = focused.has(dependency.successorTaskId);
    if (predecessorIsFocused && successorIsFocused) {
      result.internal.push(dependency);
    } else if (!predecessorIsFocused && successorIsFocused) {
      result.incomingExternal.push(dependency);
    } else if (predecessorIsFocused && !successorIsFocused) {
      result.outgoingExternal.push(dependency);
    }
  }

  return result;
}
