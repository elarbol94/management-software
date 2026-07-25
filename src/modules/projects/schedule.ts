export type ScheduleTask = {
  id: string;
  parentTaskId?: string | null;
  startDate: string | null;
  dueDate: string | null;
  progress?: number;
  isMilestone?: boolean;
};

export type ScheduleRollup = {
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  unscheduledCount: number;
};

export type ScheduleDependency = {
  id?: string;
  predecessorTaskId: string;
  successorTaskId: string;
  lagWorkdays: number;
};

export type ScheduleChange = {
  taskId: string;
  beforeStartDate: string | null;
  beforeDueDate: string | null;
  afterStartDate: string | null;
  afterDueDate: string | null;
};

export type TaskTreeNode<T> = T & {
  depth: number;
  children: TaskTreeNode<T>[];
};

export type TaskSubtree<T> = {
  root: T;
  descendants: T[];
  leaves: T[];
};

export type AncestorExpansion = {
  taskId: string;
  startDate: string | null;
  dueDate: string | null;
  expandedStart: boolean;
  expandedEnd: boolean;
};

export type PlacementSuggestion = {
  startDate: string;
  dueDate: string;
  expandsAncestors: boolean;
  reason: "free-gap" | "after-siblings" | "near-today";
};

export type ScheduleConstraint = {
  startDate: string | null;
  dueDate: string | null;
  clampedStart: boolean;
  clampedEnd: boolean;
};

const DAY_MS = 86_400_000;

function parseIsoDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isWorkday(value: string): boolean {
  const day = parseIsoDate(value).getUTCDay();
  return day !== 0 && day !== 6;
}

export function normalizeToWorkday(
  value: string,
  direction: "forward" | "backward" = "forward",
): string {
  const date = parseIsoDate(value);
  const step = direction === "forward" ? DAY_MS : -DAY_MS;
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setTime(date.getTime() + step);
  }
  return toIsoDate(date);
}

export function addWorkdays(value: string, amount: number): string {
  if (!Number.isInteger(amount)) throw new Error("Workday offset must be an integer");
  let date = parseIsoDate(value);
  if (amount === 0) return normalizeToWorkday(value);
  const direction = amount > 0 ? 1 : -1;
  let remaining = Math.abs(amount);
  while (remaining > 0) {
    date = new Date(date.getTime() + direction * DAY_MS);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return toIsoDate(date);
}

export function workdaysInclusive(startDate: string, dueDate: string): number {
  const start = parseIsoDate(normalizeToWorkday(startDate));
  const end = parseIsoDate(normalizeToWorkday(dueDate, "backward"));
  if (end < start) return 0;
  let total = 0;
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) total += 1;
  }
  return total;
}

export function dueDateForDuration(startDate: string, workdays: number): string {
  const start = normalizeToWorkday(startDate);
  return addWorkdays(start, Math.max(1, Math.round(workdays)) - 1);
}

export function workdayDistance(fromDate: string, toDate: string): number {
  const from = normalizeToWorkday(fromDate);
  const to = normalizeToWorkday(toDate);
  if (from === to) return 0;
  const direction = to > from ? 1 : -1;
  let cursor = from;
  let distance = 0;
  while (cursor !== to) {
    cursor = addWorkdays(cursor, direction);
    distance += direction;
  }
  return distance;
}

export function dependencyStartDate(
  predecessorDueDate: string,
  lagWorkdays: number,
): string {
  return addWorkdays(predecessorDueDate, lagWorkdays + 1);
}

export function hasDependencyCycle(
  taskIds: Iterable<string>,
  dependencies: ScheduleDependency[],
): boolean {
  const ids = new Set(taskIds);
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  ids.forEach((id) => indegree.set(id, 0));
  for (const dependency of dependencies) {
    if (!ids.has(dependency.predecessorTaskId) || !ids.has(dependency.successorTaskId)) {
      continue;
    }
    (outgoing.get(dependency.predecessorTaskId) ?? outgoing.set(dependency.predecessorTaskId, []).get(dependency.predecessorTaskId)!).push(
      dependency.successorTaskId,
    );
    indegree.set(
      dependency.successorTaskId,
      (indegree.get(dependency.successorTaskId) ?? 0) + 1,
    );
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    for (const next of outgoing.get(id) ?? []) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  return visited !== ids.size;
}

function latestConstraint(
  taskId: string,
  tasks: Map<string, ScheduleTask>,
  dependencies: ScheduleDependency[],
): string | null {
  let latest: string | null = null;
  for (const dependency of dependencies) {
    if (dependency.successorTaskId !== taskId) continue;
    const predecessor = tasks.get(dependency.predecessorTaskId);
    if (!predecessor?.dueDate) continue;
    const constraint = dependencyStartDate(
      predecessor.dueDate,
      dependency.lagWorkdays,
    );
    if (latest === null || constraint > latest) latest = constraint;
  }
  return latest;
}

export function previewScheduleCascade(
  sourceTasks: ScheduleTask[],
  dependencies: ScheduleDependency[],
  rootChange: {
    taskId: string;
    startDate: string;
    dueDate: string;
  },
): ScheduleChange[] {
  if (hasDependencyCycle(sourceTasks.map((task) => task.id), dependencies)) {
    throw new Error("Dependency cycle");
  }
  const original = new Map(sourceTasks.map((task) => [task.id, task]));
  const tasks = new Map(
    sourceTasks.map((task) => [task.id, { ...task }]),
  );
  const root = tasks.get(rootChange.taskId);
  if (!root) throw new Error("Task not found");
  const normalizedStart = normalizeToWorkday(rootChange.startDate);
  const normalizedDue = root.isMilestone
    ? normalizedStart
    : normalizeToWorkday(rootChange.dueDate, "backward");
  if (normalizedDue < normalizedStart) throw new Error("Due date precedes start date");
  tasks.set(root.id, {
    ...root,
    startDate: normalizedStart,
    dueDate: normalizedDue,
  });

  const outgoing = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const list = outgoing.get(dependency.predecessorTaskId) ?? [];
    list.push(dependency.successorTaskId);
    outgoing.set(dependency.predecessorTaskId, list);
  }
  const queue = [root.id];
  const queued = new Set(queue);
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const successorId of outgoing.get(currentId) ?? []) {
      const successor = tasks.get(successorId);
      if (!successor) continue;
      const constraint = latestConstraint(successorId, tasks, dependencies);
      if (
        constraint &&
        successor.startDate &&
        successor.dueDate &&
        successor.startDate < constraint
      ) {
        const duration = successor.isMilestone
          ? 1
          : Math.max(1, workdaysInclusive(successor.startDate, successor.dueDate));
        tasks.set(successorId, {
          ...successor,
          startDate: constraint,
          dueDate: successor.isMilestone
            ? constraint
            : dueDateForDuration(constraint, duration),
        });
      }
      if (!queued.has(successorId)) {
        queued.add(successorId);
        queue.push(successorId);
      }
    }
  }

  const changes: ScheduleChange[] = [];
  for (const [taskId, task] of tasks) {
    const before = original.get(taskId)!;
    if (before.startDate !== task.startDate || before.dueDate !== task.dueDate) {
      changes.push({
        taskId,
        beforeStartDate: before.startDate,
        beforeDueDate: before.dueDate,
        afterStartDate: task.startDate,
        afterDueDate: task.dueDate,
      });
    }
  }
  return changes;
}

export function dependencyConflicts(
  tasks: ScheduleTask[],
  dependencies: ScheduleDependency[],
): Set<string> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const conflicts = new Set<string>();
  for (const dependency of dependencies) {
    const predecessor = byId.get(dependency.predecessorTaskId);
    const successor = byId.get(dependency.successorTaskId);
    if (!predecessor?.dueDate || !successor?.startDate) continue;
    if (
      successor.startDate <
      dependencyStartDate(predecessor.dueDate, dependency.lagWorkdays)
    ) {
      conflicts.add(successor.id);
    }
  }
  return conflicts;
}

export function criticalPathTaskIds(
  tasks: ScheduleTask[],
  dependencies: ScheduleDependency[],
): Set<string> {
  if (hasDependencyCycle(tasks.map((task) => task.id), dependencies)) return new Set();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  for (const dependency of dependencies) {
    if (!byId.has(dependency.predecessorTaskId) || !byId.has(dependency.successorTaskId)) continue;
    (incoming.get(dependency.successorTaskId) ?? incoming.set(dependency.successorTaskId, []).get(dependency.successorTaskId)!).push(
      dependency.predecessorTaskId,
    );
    (outgoing.get(dependency.predecessorTaskId) ?? outgoing.set(dependency.predecessorTaskId, []).get(dependency.predecessorTaskId)!).push(
      dependency.successorTaskId,
    );
    indegree.set(dependency.successorTaskId, (indegree.get(dependency.successorTaskId) ?? 0) + 1);
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  const distance = new Map<string, number>();
  const previous = new Map<string, string | null>();
  let endId: string | null = null;
  while (queue.length > 0) {
    const id = queue.shift()!;
    const task = byId.get(id)!;
    const weight =
      task.startDate && task.dueDate
        ? Math.max(1, workdaysInclusive(task.startDate, task.dueDate))
        : 1;
    let bestDistance = 0;
    let bestPrevious: string | null = null;
    for (const predecessorId of incoming.get(id) ?? []) {
      const candidate = distance.get(predecessorId) ?? 0;
      if (candidate > bestDistance) {
        bestDistance = candidate;
        bestPrevious = predecessorId;
      }
    }
    distance.set(id, bestDistance + weight);
    previous.set(id, bestPrevious);
    if (endId === null || (distance.get(id) ?? 0) > (distance.get(endId) ?? 0)) {
      endId = id;
    }
    for (const successorId of outgoing.get(id) ?? []) {
      const degree = (indegree.get(successorId) ?? 0) - 1;
      indegree.set(successorId, degree);
      if (degree === 0) queue.push(successorId);
    }
  }
  const result = new Set<string>();
  while (endId) {
    result.add(endId);
    endId = previous.get(endId) ?? null;
  }
  return result;
}

export function weightedProgress(tasks: ScheduleTask[]): number {
  if (tasks.length === 0) return 0;
  let weighted = 0;
  let weightTotal = 0;
  for (const task of tasks) {
    const weight =
      task.isMilestone
        ? 1
        : task.startDate && task.dueDate
          ? Math.max(1, workdaysInclusive(task.startDate, task.dueDate))
          : 1;
    weighted += Math.min(100, Math.max(0, task.progress ?? 0)) * weight;
    weightTotal += weight;
  }
  return Math.round(weighted / weightTotal);
}

export function taskChildren<T extends { id: string; parentTaskId?: string | null }>(
  tasks: T[],
  parentTaskId: string,
): T[] {
  return tasks.filter((task) => task.parentTaskId === parentTaskId);
}

export function buildTaskForest<
  T extends { id: string; parentTaskId?: string | null; sortOrder?: number },
>(tasks: T[]): TaskTreeNode<T>[] {
  const nodes = new Map<string, TaskTreeNode<T>>(
    tasks.map((task) => [task.id, { ...task, depth: 0, children: [] }]),
  );
  const roots: TaskTreeNode<T>[] = [];
  for (const task of tasks) {
    const node = nodes.get(task.id)!;
    const parent = task.parentTaskId ? nodes.get(task.parentTaskId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortAndDepth = (items: TaskTreeNode<T>[], depth: number) => {
    items.sort(
      (left, right) =>
        (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
        left.id.localeCompare(right.id),
    );
    for (const item of items) {
      item.depth = depth;
      sortAndDepth(item.children, depth + 1);
    }
  };
  sortAndDepth(roots, 0);
  return roots;
}

export function taskDescendants<
  T extends { id: string; parentTaskId?: string | null },
>(tasks: T[], taskId: string): T[] {
  const byParent = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.parentTaskId) continue;
    const siblings = byParent.get(task.parentTaskId) ?? [];
    siblings.push(task);
    byParent.set(task.parentTaskId, siblings);
  }
  const result: T[] = [];
  const queue = [...(byParent.get(taskId) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift()!;
    result.push(next);
    queue.push(...(byParent.get(next.id) ?? []));
  }
  return result;
}

export function taskAncestors<
  T extends { id: string; parentTaskId?: string | null },
>(tasks: T[], taskId: string): T[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const result: T[] = [];
  const seen = new Set<string>([taskId]);
  let cursor = byId.get(taskId);
  while (cursor?.parentTaskId) {
    if (seen.has(cursor.parentTaskId)) throw new Error("Task hierarchy cycle");
    seen.add(cursor.parentTaskId);
    const parent = byId.get(cursor.parentTaskId);
    if (!parent) break;
    result.push(parent);
    cursor = parent;
  }
  return result;
}

export function taskDepth<
  T extends { id: string; parentTaskId?: string | null },
>(tasks: T[], taskId: string): number {
  return taskAncestors(tasks, taskId).length;
}

export function taskSubtree<
  T extends { id: string; parentTaskId?: string | null },
>(tasks: T[], taskId: string): TaskSubtree<T> {
  const root = tasks.find((task) => task.id === taskId);
  if (!root) throw new Error("Task not found");
  const descendants = taskDescendants(tasks, taskId);
  return { root, descendants, leaves: leafTasks([root, ...descendants]) };
}

export function shiftScheduledTasks<
  T extends Pick<ScheduleTask, "startDate" | "dueDate">,
>(tasks: T[], workdayOffset: number): T[] {
  return tasks.map((task) =>
    task.startDate && task.dueDate
      ? {
          ...task,
          startDate: addWorkdays(task.startDate, workdayOffset),
          dueDate: addWorkdays(task.dueDate, workdayOffset),
        }
      : { ...task },
  );
}

export function leafTasks<T extends { id: string; parentTaskId?: string | null }>(
  tasks: T[],
): T[] {
  const parentIds = new Set(
    tasks
      .map((task) => task.parentTaskId)
      .filter((parentTaskId): parentTaskId is string => Boolean(parentTaskId)),
  );
  return tasks.filter((task) => !parentIds.has(task.id));
}

export function descendantEnvelope(
  tasks: Pick<ScheduleTask, "startDate" | "dueDate">[],
): { startDate: string | null; dueDate: string | null } {
  const starts = tasks
    .map((task) => task.startDate)
    .filter((value): value is string => Boolean(value));
  const finishes = tasks
    .map((task) => task.dueDate)
    .filter((value): value is string => Boolean(value));
  return {
    startDate: starts.length ? starts.sort()[0] : null,
    dueDate: finishes.length ? finishes.sort().at(-1)! : null,
  };
}

export function expandContainerToChildren(
  container: Pick<ScheduleTask, "id" | "startDate" | "dueDate">,
  descendants: Pick<ScheduleTask, "startDate" | "dueDate">[],
): AncestorExpansion {
  const envelope = descendantEnvelope(descendants);
  const startDate =
    envelope.startDate && (!container.startDate || envelope.startDate < container.startDate)
      ? envelope.startDate
      : container.startDate;
  const dueDate =
    envelope.dueDate && (!container.dueDate || envelope.dueDate > container.dueDate)
      ? envelope.dueDate
      : container.dueDate;
  return {
    taskId: container.id,
    startDate,
    dueDate,
    expandedStart: startDate !== container.startDate,
    expandedEnd: dueDate !== container.dueDate,
  };
}

export function clampContainerToChildren(
  desired: Pick<ScheduleTask, "startDate" | "dueDate">,
  descendants: Pick<ScheduleTask, "startDate" | "dueDate">[],
): ScheduleConstraint {
  const envelope = descendantEnvelope(descendants);
  const startDate =
    envelope.startDate && (!desired.startDate || desired.startDate > envelope.startDate)
      ? envelope.startDate
      : desired.startDate;
  const dueDate =
    envelope.dueDate && (!desired.dueDate || desired.dueDate < envelope.dueDate)
      ? envelope.dueDate
      : desired.dueDate;
  return {
    startDate,
    dueDate,
    clampedStart: startDate !== desired.startDate,
    clampedEnd: dueDate !== desired.dueDate,
  };
}

export function suggestTaskPlacement(input: {
  today: string;
  parent?: Pick<ScheduleTask, "startDate" | "dueDate"> | null;
  siblings: Pick<ScheduleTask, "startDate" | "dueDate">[];
  workdays?: number;
}): PlacementSuggestion {
  const duration = Math.max(1, Math.round(input.workdays ?? 5));
  const parentStart = input.parent?.startDate
    ? normalizeToWorkday(input.parent.startDate)
    : null;
  const parentDue = input.parent?.dueDate
    ? normalizeToWorkday(input.parent.dueDate, "backward")
    : null;
  const ranges = input.siblings
    .filter(
      (task): task is { startDate: string; dueDate: string } =>
        Boolean(task.startDate && task.dueDate),
    )
    .map((task) => ({
      startDate: normalizeToWorkday(task.startDate),
      dueDate: normalizeToWorkday(task.dueDate, "backward"),
    }))
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
  let cursor = parentStart ?? normalizeToWorkday(input.today);
  for (const range of ranges) {
    const candidateDue = dueDateForDuration(cursor, duration);
    if (candidateDue < range.startDate && (!parentDue || candidateDue <= parentDue)) {
      return {
        startDate: cursor,
        dueDate: candidateDue,
        expandsAncestors: false,
        reason: "free-gap",
      };
    }
    if (range.dueDate >= cursor) cursor = addWorkdays(range.dueDate, 1);
  }
  const dueDate = dueDateForDuration(cursor, duration);
  const expandsAncestors = Boolean(parentDue && dueDate > parentDue);
  return {
    startDate: cursor,
    dueDate,
    expandsAncestors,
    reason: ranges.length ? "after-siblings" : parentStart ? "free-gap" : "near-today",
  };
}

export function rollupTaskSchedule(children: ScheduleTask[]): ScheduleRollup {
  const starts = children
    .map((task) => task.startDate)
    .filter((value): value is string => Boolean(value))
    .sort();
  const finishes = children
    .map((task) => task.dueDate)
    .filter((value): value is string => Boolean(value))
    .sort();
  return {
    startDate: starts[0] ?? null,
    dueDate: finishes.at(-1) ?? null,
    progress: weightedProgress(children),
    unscheduledCount: children.filter((task) => !task.startDate || !task.dueDate).length,
  };
}

export function assertTaskHierarchy<
  T extends { id: string; projectId: string; parentTaskId?: string | null; isMilestone?: boolean },
>(tasks: T[], task: T): void {
  if (!task.parentTaskId) return;
  const parent = tasks.find((candidate) => candidate.id === task.parentTaskId);
  if (!parent) throw new Error("Parent task not found");
  if (parent.projectId !== task.projectId) throw new Error("Parent task belongs to another project");
  if (parent.isMilestone) throw new Error("Milestones cannot contain subtasks");
  if (parent.id === task.id) throw new Error("A task cannot be its own parent");
  const descendants = taskDescendants(tasks, task.id);
  if (descendants.some((descendant) => descendant.id === parent.id)) {
    throw new Error("Task hierarchy cycle");
  }
}
