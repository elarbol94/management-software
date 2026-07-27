/**
 * How a task reacts when one of its predecessors moves.
 *
 * - `asap` follows the predecessor in both directions: it is pulled earlier as
 *   well as pushed later.
 * - `start_no_earlier_than` treats `constraintDate` as a floor, so the task is
 *   pushed later but never pulled back before that date.
 * - `must_start_on` pins the task to `constraintDate` regardless of its
 *   predecessors; the resulting overlap surfaces as a dependency conflict.
 */
export type ScheduleConstraintType =
  | "asap"
  | "start_no_earlier_than"
  | "must_start_on";

export type ScheduleTask = {
  id: string;
  parentTaskId?: string | null;
  startDate: string | null;
  dueDate: string | null;
  progress?: number;
  isMilestone?: boolean;
  constraintType?: ScheduleConstraintType | null;
  constraintDate?: string | null;
};

export type ScheduleRollup = {
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  unscheduledCount: number;
};

export const DEPENDENCY_TYPES = [
  "finish_to_start",
  "start_to_start",
  "finish_to_finish",
  "start_to_finish",
] as const;

export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export type ScheduleDependency = {
  id?: string;
  predecessorTaskId: string;
  successorTaskId: string;
  dependencyType: DependencyType;
  lagDays: number;
};

type ScheduleDependencyLike = Omit<ScheduleDependency, "dependencyType"> & {
  dependencyType?: DependencyType;
};

export type ScheduleChange = {
  taskId: string;
  beforeStartDate: string | null;
  beforeDueDate: string | null;
  afterStartDate: string | null;
  afterDueDate: string | null;
};

export type ScheduleEntityType = "task" | "project";

export type ScheduleOperation =
  | "move"
  | "resize-start"
  | "resize-end"
  | "place"
  | "fit";

/**
 * A user-authored scheduling intent. Dates are omitted for `fit`, where the
 * descendant envelope is the requested result.
 */
export type ScheduleEdit = {
  entityType: ScheduleEntityType;
  entityId: string;
  operation: ScheduleOperation;
  startDate?: string | null;
  dueDate?: string | null;
};

export type SchedulePortfolioTask = ScheduleTask & {
  projectId: string;
};

export type ScheduleProject = {
  id: string;
  startDate: string | null;
  dueDate: string | null;
};

export type ScheduleChangeCause =
  | "direct"
  | "fit"
  | "subtree"
  | "dependency"
  | "ancestor-expansion";

export type ScheduleEntityChange = {
  entityType: ScheduleEntityType;
  entityId: string;
  beforeStartDate: string | null;
  beforeDueDate: string | null;
  afterStartDate: string | null;
  afterDueDate: string | null;
  cause: ScheduleChangeCause;
  title?: string;
};

export type ScheduleImpact = {
  dayDelta: number;
  affectedTaskCount: number;
  affectedProjectCount: number;
  expandedTaskCount: number;
  expandedProjectCount: number;
  conflictTaskIds: string[];
};

export type SchedulePreview = {
  edit: ScheduleEdit;
  changes: ScheduleEntityChange[];
  impact: ScheduleImpact;
  constraints: ScheduleConstraint[];
};

export type SchedulePlanInput = {
  tasks: SchedulePortfolioTask[];
  projects: ScheduleProject[];
  dependencies: ScheduleDependency[];
  edit: ScheduleEdit;
};

export type ScheduleContainmentViolation = {
  entityType: ScheduleEntityType;
  entityId: string;
  violatesStart: boolean;
  violatesEnd: boolean;
  constrainingTaskIds: string[];
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
  entityType?: ScheduleEntityType;
  entityId?: string;
  startDate: string | null;
  dueDate: string | null;
  clampedStart: boolean;
  clampedEnd: boolean;
  requestedStartDate?: string | null;
  requestedDueDate?: string | null;
  constrainingTaskIds?: string[];
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

export function addCalendarDays(value: string, amount: number): string {
  if (!Number.isInteger(amount)) throw new Error("Day offset must be an integer");
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return toIsoDate(date);
}

export function calendarDaysInclusive(startDate: string, dueDate: string): number {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(dueDate);
  if (end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

export function dueDateForDuration(startDate: string, days: number): string {
  parseIsoDate(startDate);
  return addCalendarDays(startDate, Math.max(1, Math.round(days)) - 1);
}

export function calendarDayDistance(fromDate: string, toDate: string): number {
  const from = parseIsoDate(fromDate);
  const to = parseIsoDate(toDate);
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * Interprets an exact-date form edit as the equivalent timeline gesture.
 * Moving both edges by the same calendar-day offset is a subtree move; changing one
 * edge is a resize; all other edits author both container bounds.
 */
export function inferScheduleEditOperation(
  before: Pick<ScheduleTask, "startDate" | "dueDate">,
  after: { startDate: string; dueDate: string },
): Exclude<ScheduleOperation, "fit"> {
  if (before.startDate && before.dueDate) {
    const startDelta = calendarDayDistance(before.startDate, after.startDate);
    const dueDelta = calendarDayDistance(before.dueDate, after.dueDate);
    if (startDelta === dueDelta && startDelta !== 0) return "move";
    if (before.startDate === after.startDate) return "resize-end";
    if (before.dueDate === after.dueDate) return "resize-start";
  }
  return "place";
}

export function dependencyStartDate(
  predecessorDueDate: string,
  lagDays: number,
): string {
  return addCalendarDays(predecessorDueDate, lagDays + 1);
}

export function dependencyTypeOf(
  dependency: Pick<ScheduleDependencyLike, "dependencyType">,
): DependencyType {
  return dependency.dependencyType ?? "finish_to_start";
}

export function dependencyEndpoints(
  dependency: Pick<ScheduleDependencyLike, "dependencyType">,
): {
  predecessor: "start" | "finish";
  successor: "start" | "finish";
} {
  switch (dependencyTypeOf(dependency)) {
    case "start_to_start":
      return { predecessor: "start", successor: "start" };
    case "finish_to_finish":
      return { predecessor: "finish", successor: "finish" };
    case "start_to_finish":
      return { predecessor: "start", successor: "finish" };
    default:
      return { predecessor: "finish", successor: "start" };
  }
}

/**
 * Returns the earliest permitted successor endpoint. Finish-to-start adds one
 * day because task ranges are inclusive; every other relationship compares its
 * endpoint dates directly.
 */
export function dependencyRequiredDate(
  predecessor: Pick<ScheduleTask, "startDate" | "dueDate">,
  dependency: Pick<ScheduleDependencyLike, "dependencyType" | "lagDays">,
): string | null {
  const endpoints = dependencyEndpoints(dependency);
  const predecessorDate =
    endpoints.predecessor === "start"
      ? predecessor.startDate
      : predecessor.dueDate;
  if (!predecessorDate) return null;
  const offset =
    dependencyTypeOf(dependency) === "finish_to_start"
      ? dependency.lagDays + 1
      : dependency.lagDays;
  return addCalendarDays(predecessorDate, offset);
}

function pushEdge(
  edges: Map<string, string[]>,
  from: string,
  to: string,
): void {
  const existing = edges.get(from);
  if (existing) existing.push(to);
  else edges.set(from, [to]);
}

/**
 * Builds the constraint graph used for cycle detection.
 *
 * Each task contributes two nodes — its start and its finish — so that summary
 * rollup can be expressed as ordinary edges instead of a special case:
 *
 * - `start → finish` for every task (a task cannot finish before it starts)
 * - `child:finish → parent:finish` and `parent:start → child:start`, because a
 *   parent spans exactly its children
 * - `predecessor:finish → successor:start` for every dependency
 *
 * A cycle in this graph is precisely a set of constraints that cannot all hold.
 * Linking a summary to one of its own subtasks produces one, and so does the
 * subtler case where a subtask precedes a task that in turn precedes the
 * subtask's own parent.
 */
function buildConstraintGraph(
  tasks: { id: string; parentTaskId?: string | null }[],
  dependencies: ScheduleDependencyLike[],
): { nodes: string[]; edges: Map<string, string[]> } {
  const ids = new Set(tasks.map((task) => task.id));
  const nodes: string[] = [];
  const edges = new Map<string, string[]>();
  for (const task of tasks) {
    nodes.push(`${task.id}:start`, `${task.id}:finish`);
    pushEdge(edges, `${task.id}:start`, `${task.id}:finish`);
  }
  for (const task of tasks) {
    if (!task.parentTaskId || !ids.has(task.parentTaskId)) continue;
    pushEdge(edges, `${task.id}:finish`, `${task.parentTaskId}:finish`);
    pushEdge(edges, `${task.parentTaskId}:start`, `${task.id}:start`);
  }
  for (const dependency of dependencies) {
    if (!ids.has(dependency.predecessorTaskId) || !ids.has(dependency.successorTaskId)) {
      continue;
    }
    const endpoints = dependencyEndpoints(dependency);
    pushEdge(
      edges,
      `${dependency.predecessorTaskId}:${endpoints.predecessor}`,
      `${dependency.successorTaskId}:${endpoints.successor}`,
    );
  }
  return { nodes, edges };
}

export function hasScheduleCycle(
  tasks: { id: string; parentTaskId?: string | null }[],
  dependencies: ScheduleDependencyLike[],
): boolean {
  const { nodes, edges } = buildConstraintGraph(tasks, dependencies);
  const indegree = new Map(nodes.map((node) => [node, 0]));
  for (const targets of edges.values()) {
    for (const target of targets) {
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
  }
  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([node]) => node);
  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited += 1;
    for (const next of edges.get(node) ?? []) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  if (visited !== nodes.length) return true;

  // The cascade planner settles whole task ranges in dependency order. A mixed
  // endpoint loop can be mathematically feasible at node level while still
  // leaving no stable whole-task order, so reject that ambiguous authoring
  // pattern as a cycle as well.
  const taskIds = new Set(tasks.map((task) => task.id));
  const taskOutgoing = new Map<string, string[]>();
  const taskIndegree = new Map(tasks.map((task) => [task.id, 0]));
  for (const dependency of dependencies) {
    if (
      !taskIds.has(dependency.predecessorTaskId) ||
      !taskIds.has(dependency.successorTaskId)
    ) {
      continue;
    }
    pushEdge(
      taskOutgoing,
      dependency.predecessorTaskId,
      dependency.successorTaskId,
    );
    taskIndegree.set(
      dependency.successorTaskId,
      (taskIndegree.get(dependency.successorTaskId) ?? 0) + 1,
    );
  }
  const taskQueue = [...taskIndegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);
  let taskVisited = 0;
  while (taskQueue.length > 0) {
    const id = taskQueue.shift()!;
    taskVisited += 1;
    for (const next of taskOutgoing.get(id) ?? []) {
      const degree = (taskIndegree.get(next) ?? 0) - 1;
      taskIndegree.set(next, degree);
      if (degree === 0) taskQueue.push(next);
    }
  }
  return taskVisited !== tasks.length;
}

/**
 * Rejects dependencies whose endpoints sit on the same branch of the tree.
 * `hasScheduleCycle` catches these too, but only after the fact and with a
 * generic message; this produces one the user can act on.
 */
export function assertDependencyEndpoints<
  T extends { id: string; parentTaskId?: string | null },
>(tasks: T[], dependency: Pick<ScheduleDependency, "predecessorTaskId" | "successorTaskId">): void {
  if (dependency.predecessorTaskId === dependency.successorTaskId) {
    throw new Error("A task cannot depend on itself");
  }
  const relatedByHierarchy =
    taskAncestors(tasks, dependency.successorTaskId).some(
      (ancestor) => ancestor.id === dependency.predecessorTaskId,
    ) ||
    taskAncestors(tasks, dependency.predecessorTaskId).some(
      (ancestor) => ancestor.id === dependency.successorTaskId,
    );
  if (relatedByHierarchy) {
    throw new Error("A summary task cannot depend on its own subtasks");
  }
}

/**
 * The earliest start every predecessor allows, or null when the task has no
 * predecessor with a finish date.
 */
function dependencyFloor(
  taskId: string,
  tasks: Map<string, ScheduleTask>,
  dependencies: ScheduleDependencyLike[],
): string | null {
  let latest: string | null = null;
  for (const dependency of dependencies) {
    if (dependency.successorTaskId !== taskId) continue;
    const predecessor = tasks.get(dependency.predecessorTaskId);
    const successor = tasks.get(taskId);
    if (!predecessor || !successor?.startDate || !successor.dueDate) continue;
    const requiredDate = dependencyRequiredDate(predecessor, dependency);
    if (!requiredDate) continue;
    const constraint =
      dependencyEndpoints(dependency).successor === "start"
        ? requiredDate
        : addCalendarDays(
            requiredDate,
            -(Math.max(
              1,
              calendarDaysInclusive(successor.startDate, successor.dueDate),
            ) - 1),
          );
    if (latest === null || constraint > latest) latest = constraint;
  }
  return latest;
}

/**
 * Where a dependent task wants to start, given what its predecessors allow and
 * the constraint it carries. Returns null when the task should stay put.
 */
function constrainedStart(
  task: ScheduleTask,
  floor: string | null,
  originalStart: string | null,
): string | null {
  const constraintType = task.constraintType ?? "asap";
  if (constraintType === "must_start_on") {
    return task.constraintDate ? toIsoDate(parseIsoDate(task.constraintDate)) : null;
  }
  if (!floor) return null;
  if (constraintType === "start_no_earlier_than") {
    const anchor = task.constraintDate ?? originalStart;
    if (!anchor) return floor;
    const normalizedAnchor = toIsoDate(parseIsoDate(anchor));
    return floor > normalizedAnchor ? floor : normalizedAnchor;
  }
  return floor;
}

function directChildren<T extends { id: string; parentTaskId?: string | null }>(
  tasks: T[],
): Map<string, T[]> {
  const byParent = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.parentTaskId) continue;
    const siblings = byParent.get(task.parentTaskId);
    if (siblings) siblings.push(task);
    else byParent.set(task.parentTaskId, [task]);
  }
  return byParent;
}

function dependencyOrder(
  tasks: ScheduleTask[],
  dependencies: ScheduleDependencyLike[],
): string[] {
  const ids = new Set(tasks.map((task) => task.id));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  for (const dependency of dependencies) {
    if (!ids.has(dependency.predecessorTaskId) || !ids.has(dependency.successorTaskId)) {
      continue;
    }
    pushEdge(outgoing, dependency.predecessorTaskId, dependency.successorTaskId);
    indegree.set(
      dependency.successorTaskId,
      (indegree.get(dependency.successorTaskId) ?? 0) + 1,
    );
  }
  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  return order;
}

/**
 * Expands every summary above changed work, deepest first. Existing slack is
 * deliberately preserved: moving descendants inward never shrinks a container.
 */
function rollupAncestorsInPlace(
  working: Map<string, ScheduleTask>,
  childrenByParent: Map<string, ScheduleTask[]>,
  depthById: Map<string, number>,
  taskIds: Iterable<string>,
): void {
  const pending = new Set<string>();
  for (const taskId of taskIds) {
    let cursor = working.get(taskId)?.parentTaskId ?? null;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      pending.add(cursor);
      cursor = working.get(cursor)?.parentTaskId ?? null;
    }
  }
  const deepestFirst = [...pending].sort(
    (left, right) => (depthById.get(right) ?? 0) - (depthById.get(left) ?? 0),
  );
  for (const parentId of deepestFirst) {
    const parent = working.get(parentId);
    if (!parent) continue;
    const children = (childrenByParent.get(parentId) ?? []).map(
      (child) => working.get(child.id) ?? child,
    );
    if (children.length === 0) continue;
    const expansion = expandContainerEnvelope(parent, children);
    working.set(parentId, {
      ...parent,
      startDate: expansion.startDate,
      dueDate: expansion.dueDate,
    });
  }
}

/**
 * Resolves a schedule edit into the full set of date changes it implies.
 *
 * The root edit is applied first — moving a summary shifts its whole subtree
 * rigidly (R2) — and then dependencies and summary rollups are settled to a
 * fixed point. Successors are both pushed later and, when they are `asap`,
 * pulled earlier (R7). Summary tasks may sit at either end of a dependency
 * (R6); a link into one shifts that subtree and leaves its internals intact.
 */
export function previewScheduleCascade(
  sourceTasks: ScheduleTask[],
  dependencies: ScheduleDependencyLike[],
  rootChange: {
    taskId: string;
    startDate?: string | null;
    dueDate?: string | null;
    operation?: ScheduleOperation;
    rigidTaskIds?: string[];
  },
): ScheduleChange[] {
  if (hasScheduleCycle(sourceTasks, dependencies)) {
    throw new Error("Dependency cycle");
  }
  const original = new Map(sourceTasks.map((task) => [task.id, task]));
  const working = new Map(sourceTasks.map((task) => [task.id, { ...task }]));
  const root = working.get(rootChange.taskId);
  if (!root) throw new Error("Task not found");

  const childrenByParent = directChildren(sourceTasks);
  const depthById = new Map(
    sourceTasks.map((task) => [task.id, taskAncestors(sourceTasks, task.id).length]),
  );
  const descendantsById = new Map(
    sourceTasks
      .filter((task) => childrenByParent.has(task.id))
      .map((task) => [task.id, taskDescendants(sourceTasks, task.id)]),
  );
  const touched = new Set<string>();
  // A moved summary is a rigid schedule block for this edit. Dependencies may
  // move work downstream of it, but may not snap one of its descendants back to
  // an old constraint anchor and deform the subtree.
  const rigidTaskIds = new Set(rootChange.rigidTaskIds ?? []);

  const moveTask = (taskId: string, startDate: string): void => {
    const task = working.get(taskId);
    if (!task) return;
    const descendants = descendantsById.get(taskId);
    if (descendants && descendants.length > 0) {
      const envelope = descendantEnvelope(descendants);
      const currentStart = task.startDate ?? envelope.startDate;
      if (!currentStart) return;
      const offset = calendarDayDistance(currentStart, startDate);
      if (offset === 0) return;
      for (const member of [
        task,
        ...descendants.map((child) => working.get(child.id)!),
      ]) {
        rigidTaskIds.add(member.id);
        if (!member.startDate || !member.dueDate) continue;
        working.set(member.id, {
          ...member,
          startDate: addCalendarDays(member.startDate, offset),
          dueDate: addCalendarDays(member.dueDate, offset),
        });
        touched.add(member.id);
      }
      return;
    }
    if (!task.startDate || !task.dueDate) return;
    const duration = task.isMilestone
      ? 1
      : Math.max(1, calendarDaysInclusive(task.startDate, task.dueDate));
    working.set(taskId, {
      ...task,
      startDate,
      dueDate: task.isMilestone ? startDate : dueDateForDuration(startDate, duration),
    });
    touched.add(taskId);
  };

  const rootDescendants = descendantsById.get(root.id);
  const operation = rootChange.operation ?? "move";
  if (operation === "fit") {
    if (!rootDescendants || rootDescendants.length === 0) {
      throw new Error("Only a task with children can be fitted");
    }
    const envelope = descendantEnvelope(
      rootDescendants.map((task) => working.get(task.id)!),
    );
    if (!envelope.startDate || !envelope.dueDate) {
      throw new Error("Schedule at least one child before fitting the task");
    }
    working.set(root.id, {
      ...root,
      startDate: envelope.startDate,
      dueDate: envelope.dueDate,
    });
    touched.add(root.id);
  } else {
    if (!rootChange.startDate || !rootChange.dueDate) {
      throw new Error("Schedule dates are required");
    }
    const normalizedStart = toIsoDate(parseIsoDate(rootChange.startDate));
    const normalizedDue = root.isMilestone
      ? normalizedStart
      : toIsoDate(parseIsoDate(rootChange.dueDate));
    if (normalizedDue < normalizedStart) {
      throw new Error("Due date precedes start date");
    }
    if (
      operation === "move" &&
      rootDescendants &&
      rootDescendants.length > 0
    ) {
      moveTask(root.id, normalizedStart);
    } else if (rootDescendants && rootDescendants.length > 0) {
      const descendants = rootDescendants.map(
        (task) => working.get(task.id)!,
      );
      const envelope = descendantEnvelope(descendants);
      const requestedStart =
        operation === "resize-end"
          ? root.startDate ?? normalizedStart
          : normalizedStart;
      const requestedDue =
        operation === "resize-start"
          ? root.dueDate ?? normalizedDue
          : normalizedDue;
      const clampedStart =
        envelope.startDate && requestedStart > envelope.startDate
          ? envelope.startDate
          : requestedStart;
      const clampedDue =
        envelope.dueDate && requestedDue < envelope.dueDate
          ? envelope.dueDate
          : requestedDue;
      working.set(root.id, {
        ...root,
        startDate: clampedStart,
        dueDate: clampedDue,
      });
      touched.add(root.id);
    } else {
      working.set(root.id, {
        ...root,
        startDate: normalizedStart,
        dueDate: normalizedDue,
      });
      touched.add(root.id);
    }
  }

  const order = dependencyOrder(sourceTasks, dependencies);
  const successorIds = new Set(dependencies.map((dependency) => dependency.successorTaskId));
  const limit = sourceTasks.length + 2;
  let settled = false;
  for (let pass = 0; pass < limit && !settled; pass += 1) {
    settled = true;
    rollupAncestorsInPlace(working, childrenByParent, depthById, touched);
    for (const taskId of order) {
      if (!successorIds.has(taskId)) continue;
      if (rigidTaskIds.has(taskId)) continue;
      const task = working.get(taskId);
      if (!task?.startDate) continue;
      const desired = constrainedStart(
        task,
        dependencyFloor(taskId, working, dependencies),
        original.get(taskId)?.startDate ?? null,
      );
      if (!desired || desired === task.startDate) continue;
      moveTask(taskId, desired);
      settled = false;
    }
  }
  if (!settled) throw new Error("Dependency cycle");
  rollupAncestorsInPlace(working, childrenByParent, depthById, touched);

  const changes: ScheduleChange[] = [];
  for (const [taskId, task] of working) {
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

function normalizedEditDates(
  edit: ScheduleEdit,
  milestone = false,
): { startDate: string; dueDate: string } {
  if (!edit.startDate || !edit.dueDate) {
    throw new Error("Schedule dates are required");
  }
  const startDate = toIsoDate(parseIsoDate(edit.startDate));
  const dueDate = milestone
    ? startDate
    : toIsoDate(parseIsoDate(edit.dueDate));
  if (dueDate < startDate) throw new Error("Due date precedes start date");
  return { startDate, dueDate };
}

function isOutwardExpansion(
  before: Pick<ScheduleTask, "startDate" | "dueDate">,
  after: Pick<ScheduleTask, "startDate" | "dueDate">,
): boolean {
  return Boolean(
    (after.startDate &&
      (!before.startDate || after.startDate < before.startDate)) ||
      (after.dueDate && (!before.dueDate || after.dueDate > before.dueDate)),
  );
}

function constrainingTaskIds(
  tasks: SchedulePortfolioTask[],
  envelope: { startDate: string | null; dueDate: string | null },
): string[] {
  return tasks
    .filter(
      (task) =>
        (envelope.startDate && task.startDate === envelope.startDate) ||
        (envelope.dueDate && task.dueDate === envelope.dueDate),
    )
    .map((task) => task.id);
}

/**
 * Pure portfolio planner shared by the browser's fluent drag preview and the
 * server's authoritative apply. It is intentionally data-only: callers supply
 * the complete dependency-connected scope and receive a canonical change set.
 */
export function previewScheduleEdit(input: SchedulePlanInput): SchedulePreview {
  const edit = { ...input.edit };
  if (hasScheduleCycle(input.tasks, input.dependencies)) {
    throw new Error("Dependency cycle");
  }

  const originalTasks = new Map(
    input.tasks.map((task) => [task.id, { ...task }]),
  );
  const workingTasks = new Map(
    input.tasks.map((task) => [task.id, { ...task }]),
  );
  const originalProjects = new Map(
    input.projects.map((project) => [project.id, { ...project }]),
  );
  const workingProjects = new Map(
    input.projects.map((project) => [project.id, { ...project }]),
  );
  const constraints: ScheduleConstraint[] = [];
  const subtreeTaskIds = new Set<string>();

  const taskList = () =>
    input.tasks.map((task) => workingTasks.get(task.id)!);

  const applyCascade = (
    taskId: string,
    operation: ScheduleOperation,
    dates?: { startDate: string; dueDate: string },
    rigidTaskIds?: string[],
  ): void => {
    for (const change of previewScheduleCascade(
      taskList(),
      input.dependencies,
      {
        taskId,
        operation,
        startDate: dates?.startDate,
        dueDate: dates?.dueDate,
        rigidTaskIds,
      },
    )) {
      const task = workingTasks.get(change.taskId)!;
      workingTasks.set(change.taskId, {
        ...task,
        startDate: change.afterStartDate,
        dueDate: change.afterDueDate,
      });
    }
  };

  if (edit.entityType === "task") {
    const target = workingTasks.get(edit.entityId);
    if (!target) throw new Error("Task not found");
    const descendants = taskDescendants(taskList(), target.id);
    if (edit.operation === "move") {
      descendants.forEach((task) => subtreeTaskIds.add(task.id));
    }
    if (
      descendants.length > 0 &&
      (edit.operation === "resize-start" ||
        edit.operation === "resize-end" ||
        edit.operation === "place")
    ) {
      const dates = normalizedEditDates(edit, target.isMilestone);
      const envelope = descendantEnvelope(descendants);
      const clampedStart = Boolean(
        envelope.startDate && dates.startDate > envelope.startDate,
      );
      const clampedEnd = Boolean(
        envelope.dueDate && dates.dueDate < envelope.dueDate,
      );
      if (clampedStart || clampedEnd) {
        constraints.push({
          entityType: "task",
          entityId: target.id,
          startDate: envelope.startDate,
          dueDate: envelope.dueDate,
          requestedStartDate: dates.startDate,
          requestedDueDate: dates.dueDate,
          clampedStart,
          clampedEnd,
          constrainingTaskIds: constrainingTaskIds(descendants, envelope),
        });
      }
    }
    applyCascade(
      target.id,
      edit.operation,
      edit.operation === "fit"
        ? undefined
        : normalizedEditDates(edit, target.isMilestone),
    );
  } else {
    const project = workingProjects.get(edit.entityId);
    if (!project) throw new Error("Project not found");
    const members = taskList().filter(
      (task) => task.projectId === project.id,
    );
    const envelope = descendantEnvelope(members);

    if (edit.operation === "fit") {
      if (!envelope.startDate || !envelope.dueDate) {
        throw new Error("Schedule at least one task before fitting the project");
      }
      workingProjects.set(project.id, {
        ...project,
        startDate: envelope.startDate,
        dueDate: envelope.dueDate,
      });
    } else {
      const dates = normalizedEditDates(edit);
      if (edit.operation === "move") {
        const currentStart = project.startDate ?? envelope.startDate;
        if (!currentStart) {
          throw new Error("Place the project before moving it");
        }
        const offset = calendarDayDistance(currentStart, dates.startDate);
        for (const shifted of shiftScheduledTasks(members, offset)) {
          const task = workingTasks.get(shifted.id)!;
          workingTasks.set(shifted.id, { ...task, ...shifted });
          if (
            task.startDate !== shifted.startDate ||
            task.dueDate !== shifted.dueDate
          ) {
            subtreeTaskIds.add(task.id);
          }
        }
        const currentDue = project.dueDate ?? envelope.dueDate;
        workingProjects.set(project.id, {
          ...project,
          startDate: dates.startDate,
          dueDate: currentDue
            ? addCalendarDays(currentDue, offset)
            : dates.dueDate,
        });

        // A no-op root edit runs the dependency fixed point over the shifted
        // graph, including cross-project successor subtrees.
        const anchor = taskList().find(
          (task) =>
            task.projectId === project.id && task.startDate && task.dueDate,
        );
        if (anchor) {
          applyCascade(anchor.id, "place", {
            startDate: anchor.startDate!,
            dueDate: anchor.dueDate!,
          }, members.map((task) => task.id));
        }
      } else {
        const requestedStart =
          edit.operation === "resize-end"
            ? project.startDate ?? dates.startDate
            : dates.startDate;
        const requestedDue =
          edit.operation === "resize-start"
            ? project.dueDate ?? dates.dueDate
            : dates.dueDate;
        const clampedStart = Boolean(
          envelope.startDate && requestedStart > envelope.startDate,
        );
        const clampedEnd = Boolean(
          envelope.dueDate && requestedDue < envelope.dueDate,
        );
        if (clampedStart || clampedEnd) {
          constraints.push({
            entityType: "project",
            entityId: project.id,
            startDate: envelope.startDate,
            dueDate: envelope.dueDate,
            requestedStartDate: requestedStart,
            requestedDueDate: requestedDue,
            clampedStart,
            clampedEnd,
            constrainingTaskIds: constrainingTaskIds(members, envelope),
          });
        }
        workingProjects.set(project.id, {
          ...project,
          startDate:
            envelope.startDate && requestedStart > envelope.startDate
              ? envelope.startDate
              : requestedStart,
          dueDate:
            envelope.dueDate && requestedDue < envelope.dueDate
              ? envelope.dueDate
              : requestedDue,
        });
      }
    }
  }

  // Every project is a minimum container. This also catches tasks moved by
  // cross-project dependency cascades.
  for (const project of workingProjects.values()) {
    const members = taskList().filter(
      (task) => task.projectId === project.id,
    );
    const expansion = expandContainerEnvelope(
      {
        id: project.id,
        startDate: project.startDate,
        dueDate: project.dueDate,
      },
      members,
    );
    workingProjects.set(project.id, {
      ...project,
      startDate: expansion.startDate,
      dueDate: expansion.dueDate,
    });
  }

  const parentIds = new Set(
    input.tasks
      .map((task) => task.parentTaskId)
      .filter((id): id is string => Boolean(id)),
  );
  const taskChanges: ScheduleEntityChange[] = input.tasks.flatMap((task) => {
    const before = originalTasks.get(task.id)!;
    const after = workingTasks.get(task.id)!;
    if (
      before.startDate === after.startDate &&
      before.dueDate === after.dueDate
    ) {
      return [];
    }
    const cause: ScheduleChangeCause =
      task.id === edit.entityId && edit.entityType === "task"
        ? edit.operation === "fit"
          ? "fit"
          : "direct"
        : subtreeTaskIds.has(task.id)
          ? "subtree"
          : parentIds.has(task.id) && isOutwardExpansion(before, after)
            ? "ancestor-expansion"
            : "dependency";
    return [{
      entityType: "task" as const,
      entityId: task.id,
      beforeStartDate: before.startDate,
      beforeDueDate: before.dueDate,
      afterStartDate: after.startDate,
      afterDueDate: after.dueDate,
      cause,
    }];
  });
  const projectChanges: ScheduleEntityChange[] = input.projects.flatMap(
    (project) => {
      const before = originalProjects.get(project.id)!;
      const after = workingProjects.get(project.id)!;
      if (
        before.startDate === after.startDate &&
        before.dueDate === after.dueDate
      ) {
        return [];
      }
      return [{
        entityType: "project" as const,
        entityId: project.id,
        beforeStartDate: before.startDate,
        beforeDueDate: before.dueDate,
        afterStartDate: after.startDate,
        afterDueDate: after.dueDate,
        cause:
          edit.entityType === "project" && edit.entityId === project.id
            ? edit.operation === "fit"
              ? "fit" as const
              : "direct" as const
            : "ancestor-expansion" as const,
      }];
    },
  );
  const changes = [...taskChanges, ...projectChanges];

  const directBefore =
    edit.entityType === "task"
      ? originalTasks.get(edit.entityId)
      : originalProjects.get(edit.entityId);
  const directAfter =
    edit.entityType === "task"
      ? workingTasks.get(edit.entityId)
      : workingProjects.get(edit.entityId);
  const dayDelta =
    directBefore?.startDate && directAfter?.startDate
      ? calendarDayDistance(directBefore.startDate, directAfter.startDate)
      : directBefore?.dueDate && directAfter?.dueDate
        ? calendarDayDistance(directBefore.dueDate, directAfter.dueDate)
        : 0;

  return {
    edit,
    changes,
    constraints,
    impact: {
      dayDelta,
      affectedTaskCount: taskChanges.length,
      affectedProjectCount: projectChanges.length,
      expandedTaskCount: taskChanges.filter(
        (change) => change.cause === "ancestor-expansion",
      ).length,
      expandedProjectCount: projectChanges.filter(
        (change) => change.cause === "ancestor-expansion",
      ).length,
      conflictTaskIds: [...dependencyConflicts(taskList(), input.dependencies)],
    },
  };
}

export function dependencyConflicts(
  tasks: ScheduleTask[],
  dependencies: ScheduleDependencyLike[],
): Set<string> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const conflicts = new Set<string>();
  for (const dependency of dependencies) {
    const predecessor = byId.get(dependency.predecessorTaskId);
    const successor = byId.get(dependency.successorTaskId);
    if (!predecessor || !successor) continue;
    const requiredDate = dependencyRequiredDate(predecessor, dependency);
    const endpoints = dependencyEndpoints(dependency);
    const actualDate =
      endpoints.successor === "start"
        ? successor.startDate
        : successor.dueDate;
    if (requiredDate && actualDate && actualDate < requiredDate) {
      conflicts.add(successor.id);
    }
  }
  return conflicts;
}

export function dependencyConflictEdgeKeys(
  tasks: ScheduleTask[],
  dependencies: ScheduleDependencyLike[],
): Set<string> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const conflicts = new Set<string>();
  for (const dependency of dependencies) {
    const predecessor = byId.get(dependency.predecessorTaskId);
    const successor = byId.get(dependency.successorTaskId);
    if (!predecessor || !successor) continue;
    const requiredDate = dependencyRequiredDate(predecessor, dependency);
    const endpoints = dependencyEndpoints(dependency);
    const actualDate =
      endpoints.successor === "start"
        ? successor.startDate
        : successor.dueDate;
    if (requiredDate && actualDate && actualDate < requiredDate) {
      conflicts.add(
        dependency.id ??
          `${dependency.predecessorTaskId}:${dependency.successorTaskId}:${dependencyTypeOf(dependency)}:${dependency.lagDays}`,
      );
    }
  }
  return conflicts;
}

export function criticalPathTaskIds(
  tasks: ScheduleTask[],
  dependencies: ScheduleDependencyLike[],
): Set<string> {
  if (hasScheduleCycle(tasks, dependencies)) return new Set();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const incoming = new Map<string, ScheduleDependencyLike[]>();
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  for (const dependency of dependencies) {
    if (!byId.has(dependency.predecessorTaskId) || !byId.has(dependency.successorTaskId)) continue;
    const existingIncoming = incoming.get(dependency.successorTaskId);
    if (existingIncoming) existingIncoming.push(dependency);
    else incoming.set(dependency.successorTaskId, [dependency]);
    pushEdge(outgoing, dependency.predecessorTaskId, dependency.successorTaskId);
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
        ? Math.max(1, calendarDaysInclusive(task.startDate, task.dueDate))
        : 1;
    let bestDistance = 0;
    let bestPrevious: string | null = null;
    for (const dependency of incoming.get(id) ?? []) {
      const predecessorId = dependency.predecessorTaskId;
      const predecessor = byId.get(predecessorId);
      if (!predecessor) continue;
      const predecessorDuration =
        predecessor.startDate && predecessor.dueDate
          ? Math.max(
              1,
              calendarDaysInclusive(
                predecessor.startDate,
                predecessor.dueDate,
              ),
            )
          : 1;
      const type = dependencyTypeOf(dependency);
      const edgeOffset =
        type === "finish_to_start"
          ? predecessorDuration + dependency.lagDays
          : type === "start_to_start"
            ? dependency.lagDays
            : type === "finish_to_finish"
              ? predecessorDuration - weight + dependency.lagDays
              : 1 - weight + dependency.lagDays;
      const candidate = (distance.get(predecessorId) ?? 0) + edgeOffset;
      if (candidate > bestDistance) {
        bestDistance = candidate;
        bestPrevious = predecessorId;
      }
    }
    distance.set(id, bestDistance);
    previous.set(id, bestPrevious);
    const finishDistance = bestDistance + weight;
    const currentEnd = endId ? byId.get(endId) : null;
    const currentEndDistance = endId
      ? (distance.get(endId) ?? 0) +
        (currentEnd?.startDate && currentEnd.dueDate
          ? Math.max(
              1,
              calendarDaysInclusive(
                currentEnd.startDate,
                currentEnd.dueDate,
              ),
            )
          : 1)
      : Number.NEGATIVE_INFINITY;
    if (endId === null || finishDistance > currentEndDistance) {
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
          ? Math.max(1, calendarDaysInclusive(task.startDate, task.dueDate))
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
>(tasks: T[], dayOffset: number): T[] {
  return tasks.map((task) =>
    task.startDate && task.dueDate
      ? {
          ...task,
          startDate: addCalendarDays(task.startDate, dayOffset),
          dueDate: addCalendarDays(task.dueDate, dayOffset),
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

/**
 * Validates the minimum-container invariant for an already-materialized
 * portfolio. It is used before undo so a historic date snapshot cannot be
 * restored into a tree that gained new descendants in the meantime.
 */
export function scheduleContainmentViolations(
  tasks: SchedulePortfolioTask[],
  projects: ScheduleProject[],
): ScheduleContainmentViolation[] {
  const violations: ScheduleContainmentViolation[] = [];
  const parentIds = new Set(
    tasks
      .map((task) => task.parentTaskId)
      .filter((id): id is string => Boolean(id)),
  );
  for (const parentId of parentIds) {
    const parent = tasks.find((task) => task.id === parentId);
    if (!parent) continue;
    const descendants = taskDescendants(tasks, parent.id);
    const envelope = descendantEnvelope(descendants);
    const violatesStart = Boolean(
      envelope.startDate &&
        (!parent.startDate || parent.startDate > envelope.startDate),
    );
    const violatesEnd = Boolean(
      envelope.dueDate &&
        (!parent.dueDate || parent.dueDate < envelope.dueDate),
    );
    if (violatesStart || violatesEnd) {
      violations.push({
        entityType: "task",
        entityId: parent.id,
        violatesStart,
        violatesEnd,
        constrainingTaskIds: constrainingTaskIds(descendants, envelope),
      });
    }
  }
  for (const project of projects) {
    const members = tasks.filter((task) => task.projectId === project.id);
    const envelope = descendantEnvelope(members);
    const violatesStart = Boolean(
      envelope.startDate &&
        (!project.startDate || project.startDate > envelope.startDate),
    );
    const violatesEnd = Boolean(
      envelope.dueDate &&
        (!project.dueDate || project.dueDate < envelope.dueDate),
    );
    if (violatesStart || violatesEnd) {
      violations.push({
        entityType: "project",
        entityId: project.id,
        violatesStart,
        violatesEnd,
        constrainingTaskIds: constrainingTaskIds(members, envelope),
      });
    }
  }
  return violations;
}

/**
 * Widens a container just enough to contain its scheduled children. Authored
 * slack is retained and unscheduled children do not constrain either edge.
 */
export function expandContainerEnvelope(
  container: Pick<ScheduleTask, "id" | "startDate" | "dueDate">,
  children: Pick<ScheduleTask, "startDate" | "dueDate">[],
): AncestorExpansion {
  const envelope = descendantEnvelope(children);
  const startDate =
    envelope.startDate &&
    (!container.startDate || envelope.startDate < container.startDate)
      ? envelope.startDate
      : container.startDate;
  const dueDate =
    envelope.dueDate &&
    (!container.dueDate || envelope.dueDate > container.dueDate)
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

/** @deprecated Use `expandContainerEnvelope`; retained for existing callers. */
export const rollupEnvelope = expandContainerEnvelope;

/**
 * How far work reaches outside a container. The same envelope powers resize
 * clamping and the UI's explanatory constraint indicator.
 */
export function containerOverflow(
  container: Pick<ScheduleTask, "startDate" | "dueDate">,
  children: Pick<ScheduleTask, "startDate" | "dueDate">[],
): ScheduleConstraint {
  const envelope = descendantEnvelope(children);
  const overflowsStart = Boolean(
    container.startDate && envelope.startDate && envelope.startDate < container.startDate,
  );
  const overflowsEnd = Boolean(
    container.dueDate && envelope.dueDate && envelope.dueDate > container.dueDate,
  );
  return {
    startDate: envelope.startDate,
    dueDate: envelope.dueDate,
    clampedStart: overflowsStart,
    clampedEnd: overflowsEnd,
  };
}

/**
 * The task a row would be nested under when indented (R5): its nearest preceding
 * sibling. Returns null when the row is already first among its siblings, or
 * when that sibling is a milestone and so cannot hold subtasks.
 */
export function indentTarget<
  T extends { id: string; parentTaskId?: string | null; sortOrder?: number; isMilestone?: boolean },
>(tasks: T[], taskId: string): T | null {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) return null;
  const siblings = tasks
    .filter((candidate) => (candidate.parentTaskId ?? null) === (task.parentTaskId ?? null))
    .sort(
      (left, right) =>
        (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.id.localeCompare(right.id),
    );
  const index = siblings.findIndex((candidate) => candidate.id === taskId);
  if (index <= 0) return null;
  const previous = siblings[index - 1];
  return previous.isMilestone ? null : previous;
}

/**
 * The parent a row would move to when outdented (R5): its grandparent, or null
 * for the project root. Returns undefined when the row is already at the root
 * and cannot be outdented any further.
 */
export function outdentTarget<
  T extends { id: string; parentTaskId?: string | null },
>(tasks: T[], taskId: string): string | null | undefined {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task?.parentTaskId) return undefined;
  const parent = tasks.find((candidate) => candidate.id === task.parentTaskId);
  return parent?.parentTaskId ?? null;
}

export function suggestTaskPlacement(input: {
  today: string;
  parent?: Pick<ScheduleTask, "startDate" | "dueDate"> | null;
  siblings: Pick<ScheduleTask, "startDate" | "dueDate">[];
  days?: number;
}): PlacementSuggestion {
  const duration = Math.max(1, Math.round(input.days ?? 5));
  const parentStart = input.parent?.startDate
    ? toIsoDate(parseIsoDate(input.parent.startDate))
    : null;
  const parentDue = input.parent?.dueDate
    ? toIsoDate(parseIsoDate(input.parent.dueDate))
    : null;
  const ranges = input.siblings
    .filter(
      (task): task is { startDate: string; dueDate: string } =>
        Boolean(task.startDate && task.dueDate),
    )
    .map((task) => ({
      startDate: toIsoDate(parseIsoDate(task.startDate)),
      dueDate: toIsoDate(parseIsoDate(task.dueDate)),
    }))
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
  let cursor = parentStart ?? toIsoDate(parseIsoDate(input.today));
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
    if (range.dueDate >= cursor) cursor = addCalendarDays(range.dueDate, 1);
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
