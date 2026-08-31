export type AnalysisRoutingPoint = { x: number; y: number };
export type AnalysisRoutingRect = { x: number; y: number; width: number; height: number };

const EDGE_CLEARANCE = 14;
const EDGE_STUB = EDGE_CLEARANCE + 8;
const BEND_PENALTY = 12;
/**
 * How far outside its own endpoints an edge looks for obstacles. The search grid is
 * built from every obstacle corner, so its size — and with it the cost of the A* — grows
 * with the square of the node count. A card this far from both ends of a short edge is
 * not what that edge has to get around.
 * ponytail: a corridor, not a full visibility graph. If routes start crossing distant
 * cards on very wide graphs, widen this before reaching for a smarter algorithm.
 */
const ROUTING_MARGIN = 260;

type Direction = 0 | 1 | 2; // none, horizontal, vertical
type HeapItem = { state: number; score: number };

class MinHeap {
  private items: HeapItem[] = [];

  get size() { return this.items.length; }

  push(item: HeapItem) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent]!.score <= item.score) break;
      this.items[index] = this.items[parent]!;
      index = parent;
    }
    this.items[index] = item;
  }

  pop() {
    const first = this.items[0];
    const last = this.items.pop();
    if (!first || !last || !this.items.length) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.items.length) break;
      const child = right < this.items.length && this.items[right]!.score < this.items[left]!.score ? right : left;
      if (this.items[child]!.score >= last.score) break;
      this.items[index] = this.items[child]!;
      index = child;
    }
    this.items[index] = last;
    return first;
  }
}

function uniqueSorted(values: number[]) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function inside(point: AnalysisRoutingPoint, rect: AnalysisRoutingRect) {
  return point.x > rect.x && point.x < rect.x + rect.width
    && point.y > rect.y && point.y < rect.y + rect.height;
}

function simplify(points: AnalysisRoutingPoint[]) {
  const result: AnalysisRoutingPoint[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last?.x === point.x && last.y === point.y) continue;
    const before = result.at(-2);
    if (before && last && ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y))) {
      result[result.length - 1] = point;
    } else {
      result.push(point);
    }
  }
  return result;
}

/**
 * The route an edge takes while the layout is still moving: out of the source, across at
 * the midpoint, into the target. It ignores obstacles, which is the point — it costs four
 * points instead of a search, so it can be recomputed on every frame of a drag.
 */
export function analysisStubRoute(source: AnalysisRoutingPoint, target: AnalysisRoutingPoint): AnalysisRoutingPoint[] {
  const start = { x: source.x + EDGE_STUB, y: source.y };
  const end = { x: target.x - EDGE_STUB, y: target.y };
  const middle = (start.x + end.x) / 2;
  return simplify([source, start, { x: middle, y: start.y }, { x: middle, y: end.y }, end, target]);
}

/**
 * Finds a rectilinear route on the visibility grid formed by the padded node
 * bounds. The short endpoint stubs deliberately cross their own node padding;
 * every section between the stubs stays outside every padded card rectangle.
 */
export function routeAnalysisEdge(
  source: AnalysisRoutingPoint,
  target: AnalysisRoutingPoint,
  nodeBounds: readonly AnalysisRoutingRect[],
): AnalysisRoutingPoint[] {
  const start = { x: source.x + EDGE_STUB, y: source.y };
  const end = { x: target.x - EDGE_STUB, y: target.y };
  const corridorLeft = Math.min(start.x, end.x) - ROUTING_MARGIN;
  const corridorRight = Math.max(start.x, end.x) + ROUTING_MARGIN;
  const corridorTop = Math.min(start.y, end.y) - ROUTING_MARGIN;
  const corridorBottom = Math.max(start.y, end.y) + ROUTING_MARGIN;
  const obstacles = nodeBounds.filter((rect) => rect.x < corridorRight && rect.x + rect.width > corridorLeft
    && rect.y < corridorBottom && rect.y + rect.height > corridorTop).map((rect) => ({
    x: rect.x - EDGE_CLEARANCE,
    y: rect.y - EDGE_CLEARANCE,
    width: rect.width + EDGE_CLEARANCE * 2,
    height: rect.height + EDGE_CLEARANCE * 2,
  }));
  const outerLeft = Math.min(start.x, end.x, ...obstacles.map(({ x }) => x)) - EDGE_STUB;
  const outerRight = Math.max(start.x, end.x, ...obstacles.map(({ x, width }) => x + width)) + EDGE_STUB;
  const outerTop = Math.min(start.y, end.y, ...obstacles.map(({ y }) => y)) - EDGE_STUB;
  const outerBottom = Math.max(start.y, end.y, ...obstacles.map(({ y, height }) => y + height)) + EDGE_STUB;
  const xs = uniqueSorted([start.x, end.x, outerLeft, outerRight, ...obstacles.flatMap(({ x, width }) => [x, x + width])]);
  const ys = uniqueSorted([start.y, end.y, outerTop, outerBottom, ...obstacles.flatMap(({ y, height }) => [y, y + height])]);
  const yCount = ys.length;
  const pointId = (xIndex: number, yIndex: number) => xIndex * yCount + yIndex;
  const pointFor = (id: number): AnalysisRoutingPoint => ({ x: xs[Math.floor(id / yCount)]!, y: ys[id % yCount]! });
  const startPoint = pointId(xs.indexOf(start.x), ys.indexOf(start.y));
  const endPoint = pointId(xs.indexOf(end.x), ys.indexOf(end.y));
  const startState = startPoint * 3 + 1; // the source stub arrives horizontally
  const distance = new Map<number, number>([[startState, 0]]);
  const previous = new Map<number, number>();
  const queue = new MinHeap();
  queue.push({ state: startState, score: Math.abs(start.x - end.x) + Math.abs(start.y - end.y) });
  let finalState: number | null = null;

  while (queue.size) {
    const current = queue.pop()!;
    const currentCost = distance.get(current.state);
    if (currentCost === undefined) continue;
    const currentPointId = Math.floor(current.state / 3);
    const direction = current.state % 3 as Direction;
    if (currentPointId === endPoint) {
      finalState = current.state;
      break;
    }
    const xIndex = Math.floor(currentPointId / yCount);
    const yIndex = currentPointId % yCount;
    const currentPoint = pointFor(currentPointId);
    const neighbors = [
      xIndex > 0 ? [xIndex - 1, yIndex, 1] : null,
      xIndex + 1 < xs.length ? [xIndex + 1, yIndex, 1] : null,
      yIndex > 0 ? [xIndex, yIndex - 1, 2] : null,
      yIndex + 1 < ys.length ? [xIndex, yIndex + 1, 2] : null,
    ] as const;

    for (const neighbor of neighbors) {
      if (!neighbor) continue;
      const [nextXIndex, nextYIndex, nextDirection] = neighbor;
      const nextPointId = pointId(nextXIndex, nextYIndex);
      const nextPoint = pointFor(nextPointId);
      const midpoint = { x: (currentPoint.x + nextPoint.x) / 2, y: (currentPoint.y + nextPoint.y) / 2 };
      if (obstacles.some((rect) => inside(nextPoint, rect) || inside(midpoint, rect))) continue;
      const step = Math.abs(currentPoint.x - nextPoint.x) + Math.abs(currentPoint.y - nextPoint.y);
      const nextCost = currentCost + step + (direction !== nextDirection ? BEND_PENALTY : 0);
      const nextState = nextPointId * 3 + nextDirection;
      if (nextCost >= (distance.get(nextState) ?? Number.POSITIVE_INFINITY)) continue;
      distance.set(nextState, nextCost);
      previous.set(nextState, current.state);
      queue.push({
        state: nextState,
        score: nextCost + Math.abs(nextPoint.x - end.x) + Math.abs(nextPoint.y - end.y),
      });
    }
  }

  if (finalState === null) return analysisStubRoute(source, target);
  const routed: AnalysisRoutingPoint[] = [];
  for (let state: number | undefined = finalState; state !== undefined; state = previous.get(state)) {
    routed.push(pointFor(Math.floor(state / 3)));
  }
  routed.reverse();
  return simplify([source, ...routed, target]);
}

/** Turns the orthogonal route into a compact SVG path with gently rounded bends. */
export function analysisEdgePath(points: readonly AnalysisRoutingPoint[], radius = 7) {
  const first = points[0];
  if (!first) return "";
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    const next = points[index + 1]!;
    const incoming = Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
    const outgoing = Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
    const bend = Math.min(radius, incoming / 2, outgoing / 2);
    const before = {
      x: point.x + Math.sign(previous.x - point.x) * bend,
      y: point.y + Math.sign(previous.y - point.y) * bend,
    };
    const after = {
      x: point.x + Math.sign(next.x - point.x) * bend,
      y: point.y + Math.sign(next.y - point.y) * bend,
    };
    path += ` L ${before.x} ${before.y} Q ${point.x} ${point.y} ${after.x} ${after.y}`;
  }
  const last = points.at(-1)!;
  return `${path} L ${last.x} ${last.y}`;
}
