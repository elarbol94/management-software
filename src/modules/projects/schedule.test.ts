import { describe, expect, it } from "vitest";
import {
  addWorkdays,
  assertDependencyEndpoints,
  assertTaskHierarchy,
  buildTaskForest,
  containerOverflow,
  criticalPathTaskIds,
  dependencyConflictEdgeKeys,
  dependencyConflicts,
  dependencyStartDate,
  hasScheduleCycle,
  inferScheduleEditOperation,
  indentTarget,
  outdentTarget,
  previewScheduleCascade,
  previewScheduleEdit,
  rollupEnvelope,
  suggestTaskPlacement,
  taskAncestors,
  taskDescendants,
  leafTasks,
  rollupTaskSchedule,
  scheduleContainmentViolations,
  shiftScheduledTasks,
  weightedProgress,
  workdaysInclusive,
} from "./schedule";

describe("project schedule", () => {
  it("skips weekends in workday arithmetic", () => {
    expect(addWorkdays("2026-07-24", 1)).toBe("2026-07-27");
    expect(addWorkdays("2026-07-27", -1)).toBe("2026-07-24");
    expect(workdaysInclusive("2026-07-24", "2026-07-27")).toBe(2);
    expect(dependencyStartDate("2026-07-24", 0)).toBe("2026-07-27");
  });

  it("maps exact-date form edits to move, resize, or place operations", () => {
    const before = {
      startDate: "2026-07-20",
      dueDate: "2026-07-24",
    };
    expect(inferScheduleEditOperation(before, {
      startDate: "2026-07-27",
      dueDate: "2026-07-31",
    })).toBe("move");
    expect(inferScheduleEditOperation(before, {
      startDate: "2026-07-20",
      dueDate: "2026-07-31",
    })).toBe("resize-end");
    expect(inferScheduleEditOperation(before, {
      startDate: "2026-07-17",
      dueDate: "2026-07-24",
    })).toBe("resize-start");
    expect(inferScheduleEditOperation(before, {
      startDate: "2026-07-21",
      dueDate: "2026-07-31",
    })).toBe("place");
  });

  it("cascades finish-to-start dependencies across a weekend", () => {
    const changes = previewScheduleCascade(
      [
        { id: "a", startDate: "2026-07-23", dueDate: "2026-07-24" },
        { id: "b", startDate: "2026-07-27", dueDate: "2026-07-29" },
        { id: "c", startDate: "2026-07-30", dueDate: "2026-07-30", isMilestone: true },
      ],
      [
        { predecessorTaskId: "a", successorTaskId: "b", lagWorkdays: 0 },
        { predecessorTaskId: "b", successorTaskId: "c", lagWorkdays: 0 },
      ],
      { taskId: "a", startDate: "2026-07-24", dueDate: "2026-07-27" },
    );
    expect(changes).toEqual([
      {
        taskId: "a",
        beforeStartDate: "2026-07-23",
        beforeDueDate: "2026-07-24",
        afterStartDate: "2026-07-24",
        afterDueDate: "2026-07-27",
      },
      {
        taskId: "b",
        beforeStartDate: "2026-07-27",
        beforeDueDate: "2026-07-29",
        afterStartDate: "2026-07-28",
        afterDueDate: "2026-07-30",
      },
      {
        taskId: "c",
        beforeStartDate: "2026-07-30",
        beforeDueDate: "2026-07-30",
        afterStartDate: "2026-07-31",
        afterDueDate: "2026-07-31",
      },
    ]);
  });

  it("detects cycles and schedule conflicts", () => {
    const dependencies = [
      { predecessorTaskId: "a", successorTaskId: "b", lagWorkdays: 0 },
      { predecessorTaskId: "b", successorTaskId: "a", lagWorkdays: 0 },
    ];
    expect(hasScheduleCycle([{ id: "a" }, { id: "b" }], dependencies)).toBe(true);
    expect(
      dependencyConflicts(
        [
          { id: "a", startDate: "2026-07-20", dueDate: "2026-07-24" },
          { id: "b", startDate: "2026-07-24", dueDate: "2026-07-27" },
        ],
        dependencies.slice(0, 1),
      ),
    ).toEqual(new Set(["b"]));
    expect(
      dependencyConflictEdgeKeys(
        [
          { id: "a", startDate: "2026-07-20", dueDate: "2026-07-24" },
          { id: "b", startDate: "2026-07-24", dueDate: "2026-07-27" },
        ],
        [{
          id: "edge",
          predecessorTaskId: "a",
          successorTaskId: "b",
          lagWorkdays: 0,
        }],
      ),
    ).toEqual(new Set(["edge"]));
  });

  it("calculates the longest dependency path and weighted progress", () => {
    const tasks = [
      { id: "a", startDate: "2026-07-20", dueDate: "2026-07-24", progress: 100 },
      { id: "b", startDate: "2026-07-27", dueDate: "2026-07-28", progress: 0 },
      { id: "c", startDate: "2026-07-27", dueDate: "2026-07-31", progress: 50 },
    ];
    expect(
      criticalPathTaskIds(tasks, [
        { predecessorTaskId: "a", successorTaskId: "b", lagWorkdays: 0 },
        { predecessorTaskId: "a", successorTaskId: "c", lagWorkdays: 0 },
      ]),
    ).toEqual(new Set(["a", "c"]));
    expect(weightedProgress(tasks.slice(0, 2))).toBe(71);
  });

  it("rolls up subtask dates, progress, and unscheduled work", () => {
    const children = [
      { id: "a", parentTaskId: "parent", startDate: "2026-07-20", dueDate: "2026-07-24", progress: 100 },
      { id: "b", parentTaskId: "parent", startDate: "2026-07-27", dueDate: "2026-07-28", progress: 0 },
      { id: "c", parentTaskId: "parent", startDate: null, dueDate: null, progress: 50 },
    ];
    expect(rollupTaskSchedule(children)).toEqual({
      startDate: "2026-07-20",
      dueDate: "2026-07-28",
      progress: 69,
      unscheduledCount: 1,
    });
    expect(leafTasks([{ id: "parent" }, ...children]).map((task) => task.id)).toEqual(["a", "b", "c"]);
  });

  it("supports arbitrary depth while enforcing matching projects", () => {
    const parent: { id: string; projectId: string; parentTaskId: string | null; isMilestone: boolean } = { id: "parent", projectId: "p", parentTaskId: null, isMilestone: false };
    const child = { ...parent, id: "child", parentTaskId: "parent" };
    expect(() => assertTaskHierarchy([parent], child)).not.toThrow();
    expect(() => assertTaskHierarchy([parent, child], { ...child, id: "grandchild", parentTaskId: "child" })).not.toThrow();
    expect(() => assertTaskHierarchy([parent], { ...child, projectId: "other" })).toThrow("another project");
    expect(() => assertTaskHierarchy([parent, child], { ...parent, parentTaskId: "child" })).toThrow("cycle");
  });

  it("builds stable recursive forests and enumerates ancestry", () => {
    const tasks = [
      { id: "root", parentTaskId: null, sortOrder: 1000 },
      { id: "child", parentTaskId: "root", sortOrder: 1000 },
      { id: "grandchild", parentTaskId: "child", sortOrder: 1000 },
    ];
    expect(buildTaskForest(tasks)[0].children[0].children[0].depth).toBe(2);
    expect(taskDescendants(tasks, "root").map((task) => task.id)).toEqual(["child", "grandchild"]);
    expect(taskAncestors(tasks, "grandchild").map((task) => task.id)).toEqual(["child", "root"]);
  });

  it("reports work reaching outside a project window instead of absorbing it", () => {
    expect(containerOverflow(
      { startDate: "2026-07-22", dueDate: "2026-07-24" },
      [{ startDate: "2026-07-20", dueDate: "2026-07-28" }],
    )).toMatchObject({
      startDate: "2026-07-20",
      dueDate: "2026-07-28",
      clampedStart: true,
      clampedEnd: true,
    });
    expect(containerOverflow(
      { startDate: "2026-07-01", dueDate: "2026-08-31" },
      [{ startDate: "2026-07-20", dueDate: "2026-07-28" }],
    )).toMatchObject({ clampedStart: false, clampedEnd: false });
  });

  it("chooses the earliest available placement", () => {
    expect(suggestTaskPlacement({
      today: "2026-07-20",
      parent: { startDate: "2026-07-20", dueDate: "2026-07-31" },
      siblings: [{ startDate: "2026-07-20", dueDate: "2026-07-22" }],
      workdays: 3,
    })).toMatchObject({
      startDate: "2026-07-23",
      dueDate: "2026-07-27",
      expandsAncestors: false,
    });
  });

  it("expands a summary around children without removing authored slack", () => {
    const container = { id: "summary", startDate: "2026-07-20", dueDate: "2026-07-31" };
    expect(
      rollupEnvelope(container, [
        { startDate: "2026-07-17", dueDate: "2026-07-24" },
        { startDate: "2026-07-27", dueDate: "2026-08-05" },
      ]),
    ).toMatchObject({
      startDate: "2026-07-17",
      dueDate: "2026-08-05",
      expandedStart: true,
      expandedEnd: true,
    });
    // Work moving inward preserves the deliberately wider container.
    expect(
      rollupEnvelope(container, [{ startDate: "2026-07-22", dueDate: "2026-07-24" }]),
    ).toMatchObject({ startDate: "2026-07-20", dueDate: "2026-07-31" });
    expect(
      rollupEnvelope(container, [{ startDate: null, dueDate: null }]),
    ).toMatchObject({ startDate: "2026-07-20", dueDate: "2026-07-31" });
  });

  it("rejects dependencies between a summary and its own branch", () => {
    const tasks = [
      { id: "parent", parentTaskId: null },
      { id: "child", parentTaskId: "parent" },
      { id: "other", parentTaskId: null },
    ];
    expect(() =>
      assertDependencyEndpoints(tasks, {
        predecessorTaskId: "parent",
        successorTaskId: "child",
      }),
    ).toThrow("own subtasks");
    expect(() =>
      assertDependencyEndpoints(tasks, {
        predecessorTaskId: "child",
        successorTaskId: "other",
      }),
    ).not.toThrow();
    // A subtask preceding a task that precedes the subtask's own parent is
    // circular even though no single link touches the same branch twice.
    expect(
      hasScheduleCycle(tasks, [
        { predecessorTaskId: "child", successorTaskId: "other", lagWorkdays: 0 },
        { predecessorTaskId: "other", successorTaskId: "parent", lagWorkdays: 0 },
      ]),
    ).toBe(true);
    expect(
      hasScheduleCycle(tasks, [
        { predecessorTaskId: "child", successorTaskId: "other", lagWorkdays: 0 },
      ]),
    ).toBe(false);
  });

  it("pulls an asap successor earlier but holds a constrained one", () => {
    const tasks = [
      { id: "a", startDate: "2026-07-20", dueDate: "2026-07-24" },
      {
        id: "asap",
        startDate: "2026-07-27",
        dueDate: "2026-07-28",
        constraintType: "asap" as const,
      },
      {
        id: "pinned",
        startDate: "2026-07-27",
        dueDate: "2026-07-28",
        constraintType: "start_no_earlier_than" as const,
        constraintDate: "2026-07-27",
      },
    ];
    const dependencies = [
      { predecessorTaskId: "a", successorTaskId: "asap", lagWorkdays: 0 },
      { predecessorTaskId: "a", successorTaskId: "pinned", lagWorkdays: 0 },
    ];
    // Moving the predecessor two workdays earlier.
    const changes = previewScheduleCascade(tasks, dependencies, {
      taskId: "a",
      startDate: "2026-07-16",
      dueDate: "2026-07-22",
    });
    const byId = new Map(changes.map((change) => [change.taskId, change]));
    expect(byId.get("asap")).toMatchObject({
      afterStartDate: "2026-07-23",
      afterDueDate: "2026-07-24",
    });
    expect(byId.has("pinned")).toBe(false);
  });

  it("shifts a summary subtree when a dependency moves it", () => {
    const tasks = [
      { id: "lead", startDate: "2026-07-20", dueDate: "2026-07-24" },
      { id: "summary", parentTaskId: null, startDate: "2026-07-20", dueDate: "2026-07-22" },
      { id: "one", parentTaskId: "summary", startDate: "2026-07-20", dueDate: "2026-07-21" },
      { id: "two", parentTaskId: "summary", startDate: "2026-07-22", dueDate: "2026-07-22" },
    ];
    const changes = previewScheduleCascade(
      tasks,
      [{ predecessorTaskId: "lead", successorTaskId: "summary", lagWorkdays: 0 }],
      { taskId: "lead", startDate: "2026-07-20", dueDate: "2026-07-24" },
    );
    const byId = new Map(changes.map((change) => [change.taskId, change]));
    // The subtree keeps its internal spacing and the summary still spans it.
    expect(byId.get("one")).toMatchObject({
      afterStartDate: "2026-07-27",
      afterDueDate: "2026-07-28",
    });
    expect(byId.get("two")).toMatchObject({
      afterStartDate: "2026-07-29",
      afterDueDate: "2026-07-29",
    });
    expect(byId.get("summary")).toMatchObject({
      afterStartDate: "2026-07-27",
      afterDueDate: "2026-07-29",
    });
  });

  it("does not automatically shrink a summary when a child moves inward", () => {
    const tasks = [
      { id: "summary", parentTaskId: null, startDate: "2026-07-20", dueDate: "2026-07-31" },
      { id: "one", parentTaskId: "summary", startDate: "2026-07-20", dueDate: "2026-07-24" },
      { id: "two", parentTaskId: "summary", startDate: "2026-07-27", dueDate: "2026-07-31" },
    ];
    const changes = previewScheduleCascade(tasks, [], {
      taskId: "two",
      startDate: "2026-07-27",
      dueDate: "2026-07-28",
    });
    expect(changes.find((change) => change.taskId === "summary")).toBeUndefined();
  });

  it("does not count a directly moved summary as an ancestor expansion", () => {
    const preview = previewScheduleEdit({
      tasks: [
        {
          id: "summary",
          projectId: "p",
          parentTaskId: null,
          startDate: "2026-07-22",
          dueDate: "2026-07-28",
        },
        {
          id: "child",
          projectId: "p",
          parentTaskId: "summary",
          startDate: "2026-07-22",
          dueDate: "2026-07-28",
        },
      ],
      projects: [
        { id: "p", startDate: "2026-07-20", dueDate: "2026-08-10" },
      ],
      dependencies: [],
      edit: {
        entityType: "task",
        entityId: "summary",
        operation: "move",
        startDate: "2026-07-23",
        dueDate: "2026-07-29",
      },
    });

    expect(preview.impact).toMatchObject({
      affectedTaskCount: 2,
      affectedProjectCount: 0,
      expandedTaskCount: 0,
      expandedProjectCount: 0,
    });
  });

  it("expands every task ancestor and the project around a deep descendant", () => {
    const preview = previewScheduleEdit({
      tasks: [
        { id: "root", projectId: "p", parentTaskId: null, startDate: "2026-07-20", dueDate: "2026-07-31" },
        { id: "parent", projectId: "p", parentTaskId: "root", startDate: "2026-07-21", dueDate: "2026-07-30" },
        { id: "child", projectId: "p", parentTaskId: "parent", startDate: "2026-07-22", dueDate: "2026-07-24" },
      ],
      projects: [{ id: "p", startDate: "2026-07-20", dueDate: "2026-07-31" }],
      dependencies: [],
      edit: {
        entityType: "task",
        entityId: "child",
        operation: "resize-end",
        startDate: "2026-07-22",
        dueDate: "2026-08-04",
      },
    });
    const byId = new Map(preview.changes.map((change) => [change.entityId, change]));
    expect(byId.get("parent")).toMatchObject({
      afterStartDate: "2026-07-21",
      afterDueDate: "2026-08-04",
      cause: "ancestor-expansion",
    });
    expect(byId.get("root")).toMatchObject({
      afterStartDate: "2026-07-20",
      afterDueDate: "2026-08-04",
      cause: "ancestor-expansion",
    });
    expect(byId.get("p")).toMatchObject({
      entityType: "project",
      afterDueDate: "2026-08-04",
      cause: "ancestor-expansion",
    });
    expect(preview.impact).toMatchObject({
      affectedTaskCount: 3,
      affectedProjectCount: 1,
      expandedTaskCount: 2,
      expandedProjectCount: 1,
    });
  });

  it("detects unsafe restored container bounds after topology changes", () => {
    expect(scheduleContainmentViolations(
      [
        { id: "parent", projectId: "p", parentTaskId: null, startDate: "2026-07-20", dueDate: "2026-07-24" },
        { id: "new-child", projectId: "p", parentTaskId: "parent", startDate: "2026-07-23", dueDate: "2026-07-31" },
      ],
      [{ id: "p", startDate: "2026-07-20", dueDate: "2026-07-28" }],
    )).toEqual([
      expect.objectContaining({
        entityType: "task",
        entityId: "parent",
        violatesStart: false,
        violatesEnd: true,
        constrainingTaskIds: ["new-child"],
      }),
      expect.objectContaining({
        entityType: "project",
        entityId: "p",
        violatesStart: false,
        violatesEnd: true,
        constrainingTaskIds: expect.arrayContaining(["new-child"]),
      }),
    ]);
  });

  it("moves a parent and its complete subtree while preserving relative dates", () => {
    const preview = previewScheduleEdit({
      tasks: [
        { id: "parent", projectId: "p", parentTaskId: null, startDate: "2026-07-20", dueDate: "2026-07-24" },
        { id: "one", projectId: "p", parentTaskId: "parent", startDate: "2026-07-20", dueDate: "2026-07-21" },
        { id: "two", projectId: "p", parentTaskId: "parent", startDate: "2026-07-22", dueDate: "2026-07-24" },
      ],
      projects: [{ id: "p", startDate: "2026-07-20", dueDate: "2026-07-31" }],
      dependencies: [],
      edit: {
        entityType: "task",
        entityId: "parent",
        operation: "move",
        startDate: "2026-07-27",
        dueDate: "2026-07-31",
      },
    });
    const byId = new Map(preview.changes.map((change) => [change.entityId, change]));
    expect(byId.get("parent")).toMatchObject({
      afterStartDate: "2026-07-27",
      afterDueDate: "2026-07-31",
      cause: "direct",
    });
    expect(byId.get("one")).toMatchObject({
      afterStartDate: "2026-07-27",
      afterDueDate: "2026-07-28",
      cause: "subtree",
    });
    expect(byId.get("two")).toMatchObject({
      afterStartDate: "2026-07-29",
      afterDueDate: "2026-07-31",
      cause: "subtree",
    });
  });

  it("does not let an incoming child dependency deform a moved parent subtree", () => {
    const preview = previewScheduleEdit({
      tasks: [
        { id: "lead", projectId: "p", parentTaskId: null, startDate: "2026-07-13", dueDate: "2026-07-17" },
        { id: "parent", projectId: "p", parentTaskId: null, startDate: "2026-07-20", dueDate: "2026-07-24" },
        {
          id: "child",
          projectId: "p",
          parentTaskId: "parent",
          startDate: "2026-07-20",
          dueDate: "2026-07-21",
          constraintType: "start_no_earlier_than",
          constraintDate: "2026-07-20",
        },
        { id: "sibling", projectId: "p", parentTaskId: "parent", startDate: "2026-07-22", dueDate: "2026-07-24" },
      ],
      projects: [{ id: "p", startDate: "2026-07-13", dueDate: "2026-07-31" }],
      dependencies: [
        { predecessorTaskId: "lead", successorTaskId: "child", lagWorkdays: 0 },
      ],
      edit: {
        entityType: "task",
        entityId: "parent",
        operation: "move",
        startDate: "2026-07-27",
        dueDate: "2026-07-31",
      },
    });
    const byId = new Map(preview.changes.map((change) => [change.entityId, change]));
    expect(byId.get("child")).toMatchObject({
      afterStartDate: "2026-07-27",
      afterDueDate: "2026-07-28",
      cause: "subtree",
    });
    expect(byId.get("sibling")).toMatchObject({
      afterStartDate: "2026-07-29",
      afterDueDate: "2026-07-31",
      cause: "subtree",
    });
    expect(byId.get("parent")).toMatchObject({
      afterStartDate: "2026-07-27",
      afterDueDate: "2026-07-31",
    });
  });

  it("clamps summary resize inside its child envelope and explains why", () => {
    const preview = previewScheduleEdit({
      tasks: [
        { id: "parent", projectId: "p", parentTaskId: null, startDate: "2026-07-20", dueDate: "2026-07-31" },
        { id: "child", projectId: "p", parentTaskId: "parent", startDate: "2026-07-22", dueDate: "2026-07-28" },
      ],
      projects: [{ id: "p", startDate: "2026-07-20", dueDate: "2026-07-31" }],
      dependencies: [],
      edit: {
        entityType: "task",
        entityId: "parent",
        operation: "resize-start",
        startDate: "2026-07-27",
        dueDate: "2026-07-31",
      },
    });
    expect(preview.changes.find((change) => change.entityId === "parent")).toMatchObject({
      afterStartDate: "2026-07-22",
      afterDueDate: "2026-07-31",
    });
    expect(preview.constraints).toEqual([
      expect.objectContaining({
        entityType: "task",
        entityId: "parent",
        clampedStart: true,
        clampedEnd: false,
        constrainingTaskIds: ["child"],
      }),
    ]);
  });

  it("fits task and project containers explicitly and reports undoable changes", () => {
    const tasks = [
      { id: "parent", projectId: "p", parentTaskId: null, startDate: "2026-07-13", dueDate: "2026-08-14" },
      { id: "child", projectId: "p", parentTaskId: "parent", startDate: "2026-07-20", dueDate: "2026-07-24" },
    ];
    const projects = [{ id: "p", startDate: "2026-07-01", dueDate: "2026-08-31" }];
    const taskFit = previewScheduleEdit({
      tasks,
      projects,
      dependencies: [],
      edit: { entityType: "task", entityId: "parent", operation: "fit" },
    });
    expect(taskFit.changes.find((change) => change.entityId === "parent")).toMatchObject({
      afterStartDate: "2026-07-20",
      afterDueDate: "2026-07-24",
      cause: "fit",
    });
    const projectFit = previewScheduleEdit({
      tasks,
      projects,
      dependencies: [],
      edit: { entityType: "project", entityId: "p", operation: "fit" },
    });
    expect(projectFit.changes.find((change) => change.entityId === "p")).toMatchObject({
      afterStartDate: "2026-07-13",
      afterDueDate: "2026-08-14",
      cause: "fit",
    });
  });

  it("moves a project and every scheduled task by the same workday offset", () => {
    const preview = previewScheduleEdit({
      tasks: [
        { id: "parent", projectId: "p", parentTaskId: null, startDate: "2026-07-23", dueDate: "2026-07-31" },
        { id: "child", projectId: "p", parentTaskId: "parent", startDate: "2026-07-24", dueDate: "2026-07-27" },
        { id: "unscheduled", projectId: "p", parentTaskId: null, startDate: null, dueDate: null },
      ],
      projects: [{ id: "p", startDate: "2026-07-23", dueDate: "2026-08-07" }],
      dependencies: [],
      edit: {
        entityType: "project",
        entityId: "p",
        operation: "move",
        startDate: "2026-07-24",
        dueDate: "2026-08-10",
      },
    });
    const byId = new Map(preview.changes.map((change) => [change.entityId, change]));
    expect(byId.get("parent")).toMatchObject({
      afterStartDate: "2026-07-24",
      afterDueDate: "2026-08-03",
      cause: "subtree",
    });
    expect(byId.get("child")).toMatchObject({
      afterStartDate: "2026-07-27",
      afterDueDate: "2026-07-28",
      cause: "subtree",
    });
    expect(byId.has("unscheduled")).toBe(false);
    expect(byId.get("p")).toMatchObject({
      afterStartDate: "2026-07-24",
      afterDueDate: "2026-08-10",
      cause: "direct",
    });
  });

  it("resolves indent and outdent targets", () => {
    const tasks = [
      { id: "first", parentTaskId: null, sortOrder: 1000 },
      { id: "second", parentTaskId: null, sortOrder: 2000 },
      { id: "gate", parentTaskId: null, sortOrder: 3000, isMilestone: true },
      { id: "after-gate", parentTaskId: null, sortOrder: 4000 },
      { id: "nested", parentTaskId: "second", sortOrder: 1000 },
    ];
    expect(indentTarget(tasks, "second")?.id).toBe("first");
    expect(indentTarget(tasks, "first")).toBeNull();
    // Milestones cannot hold subtasks, so they are never an indent target.
    expect(indentTarget(tasks, "after-gate")).toBeNull();
    expect(outdentTarget(tasks, "nested")).toBeNull();
    expect(outdentTarget(tasks, "second")).toBeUndefined();
  });

  it("moves a complete project task tree by a working-day offset", () => {
    expect(
      shiftScheduledTasks(
        [
          { id: "parent", startDate: "2026-07-23", dueDate: "2026-07-31" },
          { id: "child", startDate: "2026-07-24", dueDate: "2026-07-27" },
          { id: "unscheduled", startDate: null, dueDate: null },
        ],
        1,
      ),
    ).toEqual([
      { id: "parent", startDate: "2026-07-24", dueDate: "2026-08-03" },
      { id: "child", startDate: "2026-07-27", dueDate: "2026-07-28" },
      { id: "unscheduled", startDate: null, dueDate: null },
    ]);
  });
});
