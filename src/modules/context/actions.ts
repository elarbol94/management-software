"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  contextLinks,
  projects,
  taskContexts,
  tasks,
  wikiPages,
  wikiPdfDocuments,
  wikiSources,
} from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import {
  contextOwnerTypes,
  contextRelationTypes,
  contextTargetTypes,
} from "./schema";
import {
  listEntityContext,
  searchKnowledgeCandidates,
  searchWorkCandidates,
  searchWorkspaceRows,
} from "./queries";
import type { ContextEntityType } from "./types";

const entitySchema = z.object({
  type: z.enum([
    ...contextOwnerTypes,
    ...contextTargetTypes,
  ] as [ContextEntityType, ...ContextEntityType[]]),
  id: z.string().min(1).max(500),
});

const linkSchema = z.object({
  ownerType: z.enum(contextOwnerTypes),
  ownerId: z.string().min(1),
  targetType: z.enum(contextTargetTypes),
  targetId: z.string().max(500).default(""),
  relation: z.enum(contextRelationTypes).default("related"),
  route: z.string().min(1).max(1000),
  label: z.string().trim().min(1).max(300),
  anchorJson: z.string().max(20_000).default("{}"),
});

function safeInternalRoute(route: string) {
  if (!route.startsWith("/") || route.startsWith("//")) {
    throw new Error("Context links must use an internal route");
  }
  return route;
}

function assertOwner(type: "project" | "task", id: string) {
  const exists =
    type === "project"
      ? db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get()
      : db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id)).get();
  if (!exists) throw new Error("Context owner not found");
}

function assertTarget(
  type: "wikiPage" | "wikiSource" | "pdf" | "app",
  id: string,
) {
  if (type === "app") return;
  const exists =
    type === "wikiPage"
      ? db.select({ id: wikiPages.id }).from(wikiPages).where(eq(wikiPages.id, id)).get()
      : type === "wikiSource"
        ? db.select({ id: wikiSources.id }).from(wikiSources).where(eq(wikiSources.id, id)).get()
        : db.select({ id: wikiPdfDocuments.id }).from(wikiPdfDocuments).where(eq(wikiPdfDocuments.id, id)).get();
  if (!exists) throw new Error("Context target not found");
}

function revalidateContextRoutes() {
  revalidatePath("/");
  revalidatePath("/projects", "layout");
  revalidatePath("/wiki", "layout");
}

export async function getEntityContext(input: {
  type: ContextEntityType;
  id: string;
}) {
  await requireUserOrThrow();
  const data = entitySchema.parse(input);
  return listEntityContext(data.type, data.id);
}

export async function findContextCandidates(input: {
  subjectType: ContextEntityType;
  query: string;
}) {
  await requireUserOrThrow();
  const data = z
    .object({
      subjectType: z.enum([
        ...contextOwnerTypes,
        ...contextTargetTypes,
      ] as [ContextEntityType, ...ContextEntityType[]]),
      query: z.string().max(200).default(""),
    })
    .parse(input);
  return data.subjectType === "project" || data.subjectType === "task"
    ? searchKnowledgeCandidates(data.query)
    : searchWorkCandidates(data.query);
}

export async function linkContext(input: z.input<typeof linkSchema>) {
  const currentUser = await requireUserOrThrow();
  const data = linkSchema.parse(input);
  assertOwner(data.ownerType, data.ownerId);
  assertTarget(data.targetType, data.targetId);
  const values = {
    ...data,
    route: safeInternalRoute(data.route),
    createdBy: currentUser.id,
    updatedAt: new Date(),
  };
  const inserted = db
    .insert(contextLinks)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: contextLinks.id })
    .get();
  revalidateContextRoutes();
  return inserted ?? db
    .select({ id: contextLinks.id })
    .from(contextLinks)
    .where(
      and(
        eq(contextLinks.ownerType, data.ownerType),
        eq(contextLinks.ownerId, data.ownerId),
        eq(contextLinks.targetType, data.targetType),
        eq(contextLinks.targetId, data.targetId),
        eq(contextLinks.relation, data.relation),
        eq(contextLinks.route, data.route),
      ),
    )
    .get();
}

export async function unlinkContext(linkId: string) {
  await requireUserOrThrow();
  const id = z.string().min(1).parse(linkId);
  const existing = db
    .select()
    .from(contextLinks)
    .where(eq(contextLinks.id, id))
    .get();
  if (!existing) return null;
  db.transaction((tx) => {
    tx.delete(contextLinks).where(eq(contextLinks.id, id)).run();
    if (existing.ownerType === "task" && existing.relation === "origin") {
      tx.delete(taskContexts)
        .where(
          and(
            eq(taskContexts.taskId, existing.ownerId),
            eq(taskContexts.type, existing.targetType),
            eq(taskContexts.entityId, existing.targetId),
          ),
        )
        .run();
    }
  });
  revalidateContextRoutes();
  return existing;
}

export async function restoreContextLink(
  input: z.input<typeof linkSchema>,
) {
  return linkContext(input);
}

export async function searchWorkspace(query: string) {
  await requireUserOrThrow();
  return searchWorkspaceRows(z.string().max(200).parse(query));
}
