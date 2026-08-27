import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { municipalityAnalyses, municipalityMetrics } from "./schema";
import { parseMunicipalityAnalysisGraph } from "./analysis";
import { parseKennzahlExpression, type KennzahlExpression } from "./kennzahlen";

export type MunicipalityAnalysisSummary = {
  id: string;
  name: string;
  updatedAt: number;
  /** Which municipality the graph is evaluated for, when it has one. */
  municipalityName: string | null;
  nodeCount: number;
};

/**
 * Read off the stored JSON rather than through the graph schema: this is the label under
 * an entry in a list, and two analyses called "Bevölkerungsdichte" are only tellable apart
 * by it. A graph too old or too broken to read simply shows no subject.
 */
function analysisSummaryFacts(graphJson: string) {
  try {
    const graph = JSON.parse(graphJson) as { subject?: { municipalityName?: unknown } | null; nodes?: unknown[] };
    const name = graph.subject?.municipalityName;
    return {
      municipalityName: typeof name === "string" && name ? name : null,
      nodeCount: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
    };
  } catch {
    return { municipalityName: null, nodeCount: 0 };
  }
}

export function listMunicipalityAnalysesForUser(ownerId: string): MunicipalityAnalysisSummary[] {
  return db
    .select({ id: municipalityAnalyses.id, name: municipalityAnalyses.name, updatedAt: municipalityAnalyses.updatedAt, graphJson: municipalityAnalyses.graphJson })
    .from(municipalityAnalyses)
    .where(eq(municipalityAnalyses.ownerId, ownerId))
    .orderBy(desc(municipalityAnalyses.updatedAt))
    .all()
    .map(({ graphJson, ...row }) => ({ ...row, updatedAt: row.updatedAt.getTime(), ...analysisSummaryFacts(graphJson) }));
}

export function getMunicipalityAnalysisForUser(id: string, ownerId: string) {
  const row = db
    .select()
    .from(municipalityAnalyses)
    .where(and(eq(municipalityAnalyses.id, id), eq(municipalityAnalyses.ownerId, ownerId)))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    graph: parseMunicipalityAnalysisGraph(row.graphJson),
    updatedAt: row.updatedAt.getTime(),
  };
}

export type MunicipalityMetricRecord = {
  id: string;
  name: string;
  unit: string;
  expression: KennzahlExpression;
  updatedAt: number;
};

export function listMunicipalityMetricsForUser(ownerId: string): MunicipalityMetricRecord[] {
  return db
    .select()
    .from(municipalityMetrics)
    .where(eq(municipalityMetrics.ownerId, ownerId))
    .orderBy(desc(municipalityMetrics.updatedAt))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      unit: row.unit,
      expression: parseKennzahlExpression(row.expressionJson),
      updatedAt: row.updatedAt.getTime(),
    }));
}
