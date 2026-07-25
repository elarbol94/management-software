import { describe, expect, it } from "vitest";
import {
  addWorkdays,
  assertTaskHierarchy,
  buildTaskForest,
  clampContainerToChildren,
  criticalPathTaskIds,
  dependencyConflicts,
  dependencyStartDate,
  expandContainerToChildren,
  hasDependencyCycle,
  previewScheduleCascade,
  suggestTaskPlacement,
  taskAncestors,
  taskDescendants,
  leafTasks,
  rollupTaskSchedule,
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
    expect(hasDependencyCycle(["a", "b"], dependencies)).toBe(true);
    expect(
      dependencyConflicts(
        [
          { id: "a", startDate: "2026-07-20", dueDate: "2026-07-24" },
          { id: "b", startDate: "2026-07-24", dueDate: "2026-07-27" },
        ],
        dependencies.slice(0, 1),
      ),
    ).toEqual(new Set(["b"]));
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

  it("clamps containers and chooses the earliest available placement", () => {
    expect(clampContainerToChildren(
      { startDate: "2026-07-22", dueDate: "2026-07-24" },
      [{ startDate: "2026-07-20", dueDate: "2026-07-28" }],
    )).toMatchObject({
      startDate: "2026-07-20",
      dueDate: "2026-07-28",
      clampedStart: true,
      clampedEnd: true,
    });
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

  it("expands parent containers without shrinking existing boundaries", () => {
    expect(
      expandContainerToChildren(
        {
          id: "project",
          startDate: "2026-07-20",
          dueDate: "2026-07-31",
        },
        [
          { startDate: "2026-07-17", dueDate: "2026-07-24" },
          { startDate: "2026-07-27", dueDate: "2026-08-05" },
        ],
      ),
    ).toMatchObject({
      startDate: "2026-07-17",
      dueDate: "2026-08-05",
      expandedStart: true,
      expandedEnd: true,
    });
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
