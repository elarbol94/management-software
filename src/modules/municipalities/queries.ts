import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { municipalityAnalyses } from "./schema";
import { parseMunicipalityAnalysisGraph } from "./analysis";

export type MunicipalityAnalysisSummary = {
  id: string;
  name: string;
  updatedAt: number;
};

export function listMunicipalityAnalysesForUser(ownerId: string): MunicipalityAnalysisSummary[] {
  return db
    .select({ id: municipalityAnalyses.id, name: municipalityAnalyses.name, updatedAt: municipalityAnalyses.updatedAt })
    .from(municipalityAnalyses)
    .where(eq(municipalityAnalyses.ownerId, ownerId))
    .orderBy(desc(municipalityAnalyses.updatedAt))
    .all()
    .map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() }));
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
