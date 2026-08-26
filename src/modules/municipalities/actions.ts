"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { requireUserOrThrow } from "@/lib/auth";
import {
  addDatasetToGraph,
  applyMunicipalityAnalysisGraphOperations,
  emptyMunicipalityAnalysisGraph,
  municipalityAnalysisGraphOperationsSchema,
  municipalityAnalysisGraphSchema,
  municipalityDatasetRefSchema,
  parseMunicipalityAnalysisGraph,
  serializeMunicipalityAnalysisGraph,
} from "./analysis";
import {
  expandKennzahlIntoGraph,
  kennzahlExpressionUnit,
  kennzahlFromGraph,
  serializeKennzahlExpression,
} from "./kennzahlen";
import { listMunicipalityAnalysesForUser, listMunicipalityMetricsForUser } from "./queries";
import { municipalityAnalyses, municipalityMetrics } from "./schema";

const idSchema = z.string().min(1).max(100);
const nameSchema = z.string().trim().min(1).max(120);

function requireOwnedAnalysis(id: string, ownerId: string) {
  const row = db
    .select()
    .from(municipalityAnalyses)
    .where(and(eq(municipalityAnalyses.id, id), eq(municipalityAnalyses.ownerId, ownerId)))
    .get();
  if (!row) throw new Error("Municipality analysis not found");
  return row;
}

function revalidateAnalyses() {
  revalidatePath("/municipalities/analysis");
}

export async function listMyMunicipalityAnalyses() {
  const user = await requireUserOrThrow();
  return listMunicipalityAnalysesForUser(user.id);
}

export async function createMunicipalityAnalysis(input: {
  name: string;
  dataset?: unknown;
  datasets?: unknown;
}) {
  const user = await requireUserOrThrow();
  const parsed = z.object({
    name: nameSchema,
    dataset: municipalityDatasetRefSchema.optional(),
    datasets: municipalityDatasetRefSchema.array().max(100).optional(),
  }).parse(input);
  const id = createId();
  let graph = emptyMunicipalityAnalysisGraph();
  let nodeId: string | null = null;
  const datasets = [...(parsed.dataset ? [parsed.dataset] : []), ...(parsed.datasets ?? [])];
  for (const dataset of datasets) {
    const added = addDatasetToGraph(graph, dataset, createId());
    graph = added.graph;
    nodeId = added.nodeId;
  }
  db.insert(municipalityAnalyses).values({
    id,
    ownerId: user.id,
    name: parsed.name,
    graphJson: serializeMunicipalityAnalysisGraph(graph),
  }).run();
  revalidateAnalyses();
  return { id, name: parsed.name, nodeId };
}

export async function createMunicipalityAnalysisAndRedirect(formData: FormData) {
  const result = await createMunicipalityAnalysis({ name: String(formData.get("name") ?? "") });
  redirect(`/municipalities/analysis?analysis=${encodeURIComponent(result.id)}`);
}

export async function addDatasetToMunicipalityAnalysis(input: {
  analysisId: string;
  dataset: unknown;
}) {
  return addDatasetsToMunicipalityAnalysis({ analysisId: input.analysisId, datasets: [input.dataset] });
}

export async function addDatasetsToMunicipalityAnalysis(input: {
  analysisId: string;
  datasets: unknown;
}) {
  const user = await requireUserOrThrow();
  const parsed = z.object({ analysisId: idSchema, datasets: municipalityDatasetRefSchema.array().min(1).max(100) }).parse(input);
  const row = requireOwnedAnalysis(parsed.analysisId, user.id);
  let graph = parseMunicipalityAnalysisGraph(row.graphJson);
  const nodeIds: string[] = [];
  let duplicateCount = 0;
  for (const dataset of parsed.datasets) {
    const added = addDatasetToGraph(graph, dataset, createId());
    graph = added.graph;
    nodeIds.push(added.nodeId);
    if (added.duplicate) duplicateCount += 1;
  }
  db.update(municipalityAnalyses)
    .set({ graphJson: serializeMunicipalityAnalysisGraph(graph), updatedAt: new Date() })
    .where(and(eq(municipalityAnalyses.id, row.id), eq(municipalityAnalyses.ownerId, user.id)))
    .run();
  revalidateAnalyses();
  return { analysisId: row.id, nodeId: nodeIds.at(-1) ?? null, nodeIds, duplicateCount };
}

export async function saveMunicipalityAnalysisGraph(input: {
  analysisId: string;
  graph: unknown;
}) {
  const user = await requireUserOrThrow();
  const analysisId = idSchema.parse(input.analysisId);
  requireOwnedAnalysis(analysisId, user.id);
  const graph = municipalityAnalysisGraphSchema.parse(input.graph);
  db.update(municipalityAnalyses)
    .set({ graphJson: serializeMunicipalityAnalysisGraph(graph), updatedAt: new Date() })
    .where(and(eq(municipalityAnalyses.id, analysisId), eq(municipalityAnalyses.ownerId, user.id)))
    .run();
  return { savedAt: Date.now() };
}

export async function applyMunicipalityAnalysisOperations(input: {
  analysisId: string;
  operations: unknown;
}) {
  const user = await requireUserOrThrow();
  const parsed = z.object({
    analysisId: idSchema,
    operations: municipalityAnalysisGraphOperationsSchema,
  }).parse(input);

  const result = db.transaction((transaction) => {
    const row = transaction
      .select()
      .from(municipalityAnalyses)
      .where(and(eq(municipalityAnalyses.id, parsed.analysisId), eq(municipalityAnalyses.ownerId, user.id)))
      .get();
    if (!row) throw new Error("Municipality analysis not found");

    const result = applyMunicipalityAnalysisGraphOperations(
      parseMunicipalityAnalysisGraph(row.graphJson),
      parsed.operations,
      expandKennzahlIntoGraph,
    );
    transaction.update(municipalityAnalyses)
      .set({ graphJson: serializeMunicipalityAnalysisGraph(result.graph), updatedAt: new Date() })
      .where(and(eq(municipalityAnalyses.id, row.id), eq(municipalityAnalyses.ownerId, user.id)))
      .run();
    return {
      savedAt: Date.now(),
      duplicateCount: result.duplicateCount,
      nodeId: result.lastDatasetNodeId,
    };
  });
  if (parsed.operations.some(({ type }) => !["move-node", "set-viewport", "set-selected-node"].includes(type))) {
    revalidateAnalyses();
  }
  return result;
}

export async function renameMunicipalityAnalysis(input: { analysisId: string; name: string }) {
  const user = await requireUserOrThrow();
  const parsed = z.object({ analysisId: idSchema, name: nameSchema }).parse(input);
  requireOwnedAnalysis(parsed.analysisId, user.id);
  db.update(municipalityAnalyses)
    .set({ name: parsed.name, updatedAt: new Date() })
    .where(and(eq(municipalityAnalyses.id, parsed.analysisId), eq(municipalityAnalyses.ownerId, user.id)))
    .run();
  revalidateAnalyses();
  return { id: parsed.analysisId, name: parsed.name };
}

export async function deleteMunicipalityAnalysis(analysisIdInput: string) {
  const user = await requireUserOrThrow();
  const analysisId = idSchema.parse(analysisIdInput);
  requireOwnedAnalysis(analysisId, user.id);
  db.delete(municipalityAnalyses)
    .where(and(eq(municipalityAnalyses.id, analysisId), eq(municipalityAnalyses.ownerId, user.id)))
    .run();
  revalidateAnalyses();
  return { deleted: true };
}


// --- user-defined Kennzahlen ------------------------------------------------

function revalidateMetrics() {
  revalidatePath("/municipalities/overview");
  revalidatePath("/municipalities/analysis");
}

export async function listMyMunicipalityMetrics() {
  const user = await requireUserOrThrow();
  return listMunicipalityMetricsForUser(user.id);
}

/**
 * Saves the sub-graph feeding one node as a reusable Kennzahl.
 *
 * The municipality is stripped so the Kennzahl applies to any of them, which is only
 * meaningful when the sub-graph is about a single municipality — otherwise it is a
 * comparison of two places and gets rejected rather than quietly reinterpreted.
 */
export async function saveMunicipalityAnalysisNodeAsMetric(input: {
  analysisId: string;
  nodeId: string;
  name: string;
}) {
  const user = await requireUserOrThrow();
  const parsed = z.object({ analysisId: idSchema, nodeId: idSchema, name: nameSchema }).parse(input);
  const row = requireOwnedAnalysis(parsed.analysisId, user.id);
  const graph = parseMunicipalityAnalysisGraph(row.graphJson);

  const result = kennzahlFromGraph(graph, parsed.nodeId);
  if (!result.ok) return { ok: false as const, reason: result.reason };

  const id = createId();
  db.insert(municipalityMetrics).values({
    id,
    ownerId: user.id,
    name: parsed.name,
    expressionJson: serializeKennzahlExpression(result.expression),
    unit: kennzahlExpressionUnit(result.expression),
  }).run();
  revalidateMetrics();
  return { ok: true as const, id, name: parsed.name };
}

export async function deleteMunicipalityMetric(metricIdInput: string) {
  const user = await requireUserOrThrow();
  const metricId = idSchema.parse(metricIdInput);
  const deleted = db.delete(municipalityMetrics)
    .where(and(eq(municipalityMetrics.id, metricId), eq(municipalityMetrics.ownerId, user.id)))
    .run();
  if (!deleted.changes) throw new Error("Municipality metric not found");
  revalidateMetrics();
  return { deleted: true };
}
