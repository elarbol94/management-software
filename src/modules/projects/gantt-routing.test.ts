import { describe, expect, it } from "vitest";
import {
  routeGanttDependency,
  type GanttRouteObstacle,
} from "./gantt-routing";

const base = {
  source: { x: 100, y: 20 },
  target: { x: 260, y: 100 },
  sourceDirection: 1 as const,
  targetDirection: -1 as const,
  stub: 16,
};

describe("Gantt dependency routing", () => {
  it("chooses the shortest simple orthogonal route without obstacles", () => {
    const route = routeGanttDependency(base);

    expect(route.points[0]).toEqual(base.source);
    expect(route.points.at(-1)).toEqual(base.target);
    expect(route.points.length).toBeLessThanOrEqual(6);
    expect(route.path).toContain("Q");
  });

  it("routes around a scheduled bar instead of crossing it", () => {
    const obstacle: GanttRouteObstacle = {
      id: "middle",
      left: 165,
      right: 205,
      top: 40,
      bottom: 80,
    };
    const route = routeGanttDependency({
      ...base,
      obstacles: [obstacle],
    });

    const verticalSegments = route.points
      .slice(1)
      .map((point, index) => [route.points[index], point] as const)
      .filter(([a, b]) => a.x === b.x);
    expect(
      verticalSegments.every(
        ([a]) => a.x < obstacle.left || a.x > obstacle.right,
      ),
    ).toBe(true);
  });

  it("avoids an occupied route when an equally short lane is available", () => {
    const first = routeGanttDependency(base);
    const second = routeGanttDependency({
      ...base,
      occupiedRoutes: [first.points],
      laneBias: 10,
    });

    expect(second.path).not.toBe(first.path);
  });

  it("moves vertical and horizontal route segments only on their natural axis", () => {
    const automatic = routeGanttDependency(base);
    const manual = routeGanttDependency({
      ...base,
      manualOffset: { x: 24, y: -22 },
    });

    expect(automatic.handles.x).not.toBeNull();
    expect(manual.handles.x?.x).toBeCloseTo(
      (automatic.handles.x?.x ?? 0) + 24,
    );
    if (automatic.handles.y) {
      expect(manual.handles.y?.y).toBeCloseTo(
        automatic.handles.y.y - 22,
      );
    }
    expect(manual.path).not.toBe(automatic.path);
    expect(
      manual.points
        .slice(1)
        .every(
          (point, index) =>
            point.x === manual.points[index].x ||
            point.y === manual.points[index].y,
        ),
    ).toBe(true);
  });
});
