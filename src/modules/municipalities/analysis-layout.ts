import {
  analysisNodeHeight,
  analysisNodeWidth,
  type MunicipalityAnalysisGraph,
  type MunicipalityAnalysisNode,
} from "./analysis";

export type AnalysisArrangeAction =
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-top"
  | "align-middle"
  | "align-bottom"
  | "distribute-horizontal"
  | "distribute-vertical";

export type AnalysisNodePositions = Record<string, { x: number; y: number }>;

/**
 * A stable left-to-right layout for the analysis DAG. Notes deliberately stay outside
 * the result: they document the reader's arrangement rather than belonging to the
 * calculation and must never jump when the formula is tidied.
 */
export function autoLayoutAnalysisGraph(graph: MunicipalityAnalysisGraph): AnalysisNodePositions {
  const nodes = graph.nodes.filter((node) => node.type !== "annotation");
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue;
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  }

  const depths = new Map<string, number>();
  const depthOf = (id: string): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    const parents = incoming.get(id) ?? [];
    const depth = parents.length ? Math.max(...parents.map(depthOf)) + 1 : 0;
    depths.set(id, depth);
    return depth;
  };
  for (const node of nodes) depthOf(node.id);

  const columns = new Map<number, MunicipalityAnalysisNode[]>();
  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0;
    columns.set(depth, [...(columns.get(depth) ?? []), node]);
  }

  const positions: AnalysisNodePositions = {};
  let x = 80;
  for (const depth of [...columns.keys()].sort((left, right) => left - right)) {
    const column = columns.get(depth)!.sort((left, right) => left.position.y - right.position.y || left.id.localeCompare(right.id));
    let y = 80;
    let columnWidth = 0;
    for (const node of column) {
      positions[node.id] = { x, y };
      y += analysisNodeHeight(node) + 64;
      columnWidth = Math.max(columnWidth, analysisNodeWidth(node));
    }
    x += columnWidth + 120;
  }
  return positions;
}

export function arrangeAnalysisNodes(
  graph: MunicipalityAnalysisGraph,
  selectedIds: readonly string[],
  action: AnalysisArrangeAction,
): AnalysisNodePositions {
  const selected = selectedIds
    .map((id) => graph.nodes.find((node) => node.id === id))
    .filter((node): node is MunicipalityAnalysisNode => Boolean(node));
  if (selected.length < 2) return {};

  const positions: AnalysisNodePositions = Object.fromEntries(selected.map((node) => [node.id, { ...node.position }]));
  const left = Math.min(...selected.map((node) => node.position.x));
  const right = Math.max(...selected.map((node) => node.position.x + analysisNodeWidth(node)));
  const top = Math.min(...selected.map((node) => node.position.y));
  const bottom = Math.max(...selected.map((node) => node.position.y + analysisNodeHeight(node)));
  const center = (left + right) / 2;
  const middle = (top + bottom) / 2;

  if (action.startsWith("align-")) {
    for (const node of selected) {
      if (action === "align-left") positions[node.id]!.x = left;
      if (action === "align-center") positions[node.id]!.x = center - analysisNodeWidth(node) / 2;
      if (action === "align-right") positions[node.id]!.x = right - analysisNodeWidth(node);
      if (action === "align-top") positions[node.id]!.y = top;
      if (action === "align-middle") positions[node.id]!.y = middle - analysisNodeHeight(node) / 2;
      if (action === "align-bottom") positions[node.id]!.y = bottom - analysisNodeHeight(node);
    }
    return positions;
  }

  if (action === "distribute-horizontal") {
    const ordered = [...selected].sort((a, b) => a.position.x - b.position.x || a.id.localeCompare(b.id));
    const firstCenter = ordered[0]!.position.x + analysisNodeWidth(ordered[0]!) / 2;
    const last = ordered.at(-1)!;
    const lastCenter = last.position.x + analysisNodeWidth(last) / 2;
    ordered.forEach((node, index) => {
      const nodeCenter = firstCenter + ((lastCenter - firstCenter) * index) / Math.max(1, ordered.length - 1);
      positions[node.id]!.x = nodeCenter - analysisNodeWidth(node) / 2;
    });
  } else {
    const ordered = [...selected].sort((a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id));
    const firstCenter = ordered[0]!.position.y + analysisNodeHeight(ordered[0]!) / 2;
    const last = ordered.at(-1)!;
    const lastCenter = last.position.y + analysisNodeHeight(last) / 2;
    ordered.forEach((node, index) => {
      const nodeCenter = firstCenter + ((lastCenter - firstCenter) * index) / Math.max(1, ordered.length - 1);
      positions[node.id]!.y = nodeCenter - analysisNodeHeight(node) / 2;
    });
  }
  return positions;
}
