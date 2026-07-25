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
  dependencies: ScheduleDependency[],
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
    pushEdge(
      edges,
      `${dependency.predecessorTaskId}:finish`,
      `${dependency.successorTaskId}:start`,
    );
  }
  return { nodes, edges };
}

export function hasScheduleCycle(
  tasks: { id: string; parentTaskId?: string | null }[],
  dependencies: ScheduleDependency[],
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
  return visited !== nodes.length;
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
    return task.constraintDate ? normalizeToWorkday(task.constraintDate) : null;
  }
  if (!floor) return null;
  if (constraintType === "start_no_earlier_than") {
    const anchor = task.constraintDate ?? originalStart;
    if (!anchor) return floor;
    const normalizedAnchor = normalizeToWorkday(anchor);
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
  dependencies: ScheduleDependency[],
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
 * Recomputes every summary that sits above a changed task, deepest first, so a
 * parent always spans exactly its direct children (R1). Parents whose children
 * are all unscheduled become unscheduled themselves.
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
    const envelope = descendantEnvelope(children);
    working.set(parentId, {
      ...parent,
      startDate: envelope.startDate,
      dueDate: envelope.dueDate,
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
  dependencies: ScheduleDependency[],
  rootChange: {
    taskId: string;
    startDate: string;
    dueDate: string;
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

  const moveTask = (taskId: string, startDate: string): void => {
    const task = working.get(taskId);
    if (!task) return;
    const descendants = descendantsById.get(taskId);
    if (descendants && descendants.length > 0) {
      if (!task.startDate) return;
      const offset = workdayDistance(task.startDate, startDate);
      if (offset === 0) return;
      for (const member of [task, ...descendants.map((child) => working.get(child.id)!)]) {
        if (!member.startDate || !member.dueDate) continue;
        working.set(member.id, {
          ...member,
          startDate: addWorkdays(member.startDate, offset),
          dueDate: addWorkdays(member.dueDate, offset),
        });
        touched.add(member.id);
      }
      return;
    }
    if (!task.startDate || !task.dueDate) return;
    const duration = task.isMilestone
      ? 1
      : Math.max(1, workdaysInclusive(task.startDate, task.dueDate));
    working.set(taskId, {
      ...task,
      startDate,
      dueDate: task.isMilestone ? startDate : dueDateForDuration(startDate, duration),
    });
    touched.add(taskId);
  };

  const normalizedStart = normalizeToWorkday(rootChange.startDate);
  const normalizedDue = root.isMilestone
    ? normalizedStart
    : normalizeToWorkday(rootChange.dueDate, "backward");
  if (normalizedDue < normalizedStart) throw new Error("Due date precedes start date");
  const rootDescendants = descendantsById.get(root.id);
  if (rootDescendants && rootDescendants.length > 0) {
    moveTask(root.id, normalizedStart);
  } else {
    working.set(root.id, {
      ...root,
      startDate: normalizedStart,
      dueDate: normalizedDue,
    });
    touched.add(root.id);
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
  if (hasScheduleCycle(tasks, dependencies)) return new Set();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  for (const dependency of dependencies) {
    if (!byId.has(dependency.predecessorTaskId) || !byId.has(dependency.successorTaskId)) continue;
    pushEdge(incoming, dependency.successorTaskId, dependency.predecessorTaskId);
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

/**
 * A summary task's dates (R1). Unlike the container helpers this replaced, the
 * result is derived purely from the children — it shrinks as readily as it
 * grows, and a summary whose children are all unscheduled is unscheduled too.
 */
export function rollupEnvelope(
  container: Pick<ScheduleTask, "id" | "startDate" | "dueDate">,
  children: Pick<ScheduleTask, "startDate" | "dueDate">[],
): AncestorExpansion {
  const envelope = descendantEnvelope(children);
  return {
    taskId: container.id,
    startDate: envelope.startDate,
    dueDate: envelope.dueDate,
    expandedStart: envelope.startDate !== container.startDate,
    expandedEnd: envelope.dueDate !== container.dueDate,
  };
}

/**
 * How far a project's tasks spill outside its authored window (R3/R4). Projects
 * keep dates the user authored, so overflow is reported rather than absorbed.
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
