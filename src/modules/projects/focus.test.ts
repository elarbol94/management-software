import { describe, expect, it } from "vitest";
import {
  classifyFocusDependencies,
  focusDateRange,
  projectFocusIdFromSearchParam,
  projectsFocusHref,
  resolveFocusedTaskSubtree,
} from "./focus";

const tasks = [
  { id: "root", parentTaskId: null, startDate: "2026-07-20", dueDate: "2026-08-14" },
  { id: "child-a", parentTaskId: "root", startDate: "2026-07-22", dueDate: "2026-07-24" },
  { id: "grandchild", parentTaskId: "child-a", startDate: "2026-07-23", dueDate: "2026-07-30" },
  { id: "child-b", parentTaskId: "root", startDate: null, dueDate: null },
  { id: "other", parentTaskId: null, startDate: "2026-08-03", dueDate: "2026-08-07" },
];

describe("project focus URLs", () => {
  it("builds the canonical project focus URL", () => {
    expect(projectsFocusHref("task / one")).toBe("/projects?focus=task%20%2F%20one");
    expect(projectsFocusHref(null)).toBe("/projects");
  });

  it("accepts one non-empty focus value only", () => {
    expect(projectFocusIdFromSearchParam(" task-1 ")).toBe("task-1");
    expect(projectFocusIdFromSearchParam("")).toBeNull();
    expect(projectFocusIdFromSearchParam(["task-1", "task-2"])).toBeNull();
    expect(projectFocusIdFromSearchParam(undefined)).toBeNull();
  });
});

describe("focused task subtree", () => {
  it("returns recursive descendants with depths normalized to the focused root", () => {
    const focus = resolveFocusedTaskSubtree(tasks, "child-a");
    expect(focus?.taskIds).toEqual(["child-a", "grandchild"]);
    expect(focus?.depthByTaskId).toEqual({ "child-a": 0, grandchild: 1 });
    expect(focus?.ancestors.map((task) => task.id)).toEqual(["root"]);
  });

  it("returns null for a stale task id", () => {
    expect(resolveFocusedTaskSubtree(tasks, "deleted")).toBeNull();
  });

  it("rejects a cycle rather than recursing forever", () => {
    const cyclic = [
      { id: "a", parentTaskId: "b", startDate: null, dueDate: null },
      { id: "b", parentTaskId: "a", startDate: null, dueDate: null },
    ];
    expect(() => resolveFocusedTaskSubtree(cyclic, "a")).toThrow("Task hierarchy cycle");
  });
});

describe("focused date range", () => {
  it("pads scheduled work by five workdays", () => {
    expect(focusDateRange(tasks.slice(0, 4), "2026-07-25")).toEqual({
      startDate: "2026-07-13",
      dueDate: "2026-08-21",
      isFallback: false,
    });
  });

  it("provides a twenty-workday fallback for unscheduled work", () => {
    expect(
      focusDateRange([{ id: "new", startDate: null, dueDate: null }], "2026-07-25"),
    ).toEqual({
      startDate: "2026-07-13",
      dueDate: "2026-08-07",
      isFallback: true,
    });
  });
});

describe("focused dependency classification", () => {
  const dependencies = [
    { id: "internal", predecessorTaskId: "child-a", successorTaskId: "grandchild" },
    { id: "incoming", predecessorTaskId: "other", successorTaskId: "child-a" },
    { id: "outgoing", predecessorTaskId: "grandchild", successorTaskId: "other" },
    { id: "irrelevant", predecessorTaskId: "elsewhere", successorTaskId: "other" },
  ];

  it("separates internal and crossing edges and omits unrelated ones", () => {
    const result = classifyFocusDependencies(dependencies, ["child-a", "grandchild"]);
    expect(result.internal.map((dependency) => dependency.id)).toEqual(["internal"]);
    expect(result.incomingExternal.map((dependency) => dependency.id)).toEqual(["incoming"]);
    expect(result.outgoingExternal.map((dependency) => dependency.id)).toEqual(["outgoing"]);
  });
});
