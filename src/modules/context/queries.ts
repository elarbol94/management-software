import {
  and,
  asc,
  desc,
  eq,
  inArray,
  like,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  contextLinks,
  evidenceLinks,
  projectColumns,
  projects,
  tasks,
  wikiPageSources,
  wikiPages,
  wikiPdfAnnotations,
  wikiPdfDocuments,
  wikiPdfPages,
  wikiSources,
} from "@/db/schema";
import type { ContextEntityType, ContextItemDto, EntityContextDto } from "./types";
import {
  canonicalEntityHref,
  canonicalTaskHref,
  withTaskFocus,
} from "./routes";

function unique(items: ContextItemDto[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.type}:${item.href}:${item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emptyContext(): EntityContextDto {
  return { parents: [], tasks: [], wiki: [], sources: [] };
}

export function listEntityContext(
  subjectType: ContextEntityType,
  subjectId: string,
): EntityContextDto {
  const result = emptyContext();

  if (subjectType === "project" || subjectType === "task") {
    const outgoing = db
      .select()
      .from(contextLinks)
      .where(
        and(
          eq(contextLinks.ownerType, subjectType),
          eq(contextLinks.ownerId, subjectId),
        ),
      )
      .orderBy(desc(contextLinks.updatedAt))
      .all();

    for (const link of outgoing) {
      const item: ContextItemDto = {
        key: link.id,
        type: link.targetType,
        title: link.label || link.route,
        href:
          subjectType === "task" &&
          link.targetType === "pdf" &&
          link.relation === "origin"
            ? withTaskFocus(link.route, subjectId)
            : link.route,
        subtitle: link.relation === "origin" ? "Ursprung" : "Verknüpft",
        relation: link.relation,
        linkId: link.id,
        removable: true,
      };
      if (link.targetType === "wikiPage") result.wiki.push(item);
      else result.sources.push(item);
    }
  } else {
    const sourcePdfIds =
      subjectType === "wikiSource"
        ? db
            .select({ id: wikiPdfDocuments.id })
            .from(wikiPdfDocuments)
            .where(eq(wikiPdfDocuments.sourceId, subjectId))
            .all()
            .map((document) => document.id)
        : [];
    const reverseTargetWhere =
      subjectType === "wikiSource" && sourcePdfIds.length > 0
        ? or(
            and(
              eq(contextLinks.targetType, "wikiSource"),
              eq(contextLinks.targetId, subjectId),
            ),
            and(
              eq(contextLinks.targetType, "pdf"),
              inArray(contextLinks.targetId, sourcePdfIds),
            ),
          )
        : and(
            eq(contextLinks.targetType, subjectType),
            eq(contextLinks.targetId, subjectId),
          );

    const reverseProjects = db
      .select({
        linkId: contextLinks.id,
        relation: contextLinks.relation,
        id: projects.id,
        name: projects.name,
        color: projects.color,
      })
      .from(contextLinks)
      .innerJoin(
        projects,
        and(
          eq(contextLinks.ownerType, "project"),
          eq(contextLinks.ownerId, projects.id),
        ),
      )
      .where(reverseTargetWhere)
      .orderBy(desc(contextLinks.updatedAt))
      .all();
    result.parents.push(
      ...reverseProjects.map((project) => ({
        key: project.linkId,
        type: "project" as const,
        title: project.name,
        href: canonicalEntityHref("project", project.id),
        subtitle: project.relation === "origin" ? "Ursprung" : "Projekt",
        relation: project.relation,
        linkId: project.linkId,
        removable: true,
      })),
    );

    const reverseTasks = db
      .select({
        linkId: contextLinks.id,
        relation: contextLinks.relation,
        id: tasks.id,
        title: tasks.title,
        projectId: tasks.projectId,
        projectName: projects.name,
        status: tasks.status,
        dueDate: tasks.dueDate,
      })
      .from(contextLinks)
      .innerJoin(
        tasks,
        and(
          eq(contextLinks.ownerType, "task"),
          eq(contextLinks.ownerId, tasks.id),
        ),
      )
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(reverseTargetWhere)
      .orderBy(desc(contextLinks.updatedAt))
      .all();
    result.tasks.push(
      ...reverseTasks.map((task) => ({
        key: task.linkId,
        type: "task" as const,
        title: task.title,
        href: canonicalTaskHref(task.id, task.projectId),
        subtitle: [
          task.projectName,
          task.status === "done" ? "Erledigt" : task.dueDate || "Offen",
        ]
          .filter(Boolean)
          .join(" · "),
        relation: task.relation,
        linkId: task.linkId,
        removable: true,
      })),
    );
  }

  if (subjectType === "project") {
    const projectTasks = db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        dueDate: tasks.dueDate,
        columnName: projectColumns.name,
      })
      .from(tasks)
      .leftJoin(projectColumns, eq(tasks.columnId, projectColumns.id))
      .where(eq(tasks.projectId, subjectId))
      .orderBy(
        sql`${tasks.status} = 'done'`,
        asc(tasks.dueDate),
        desc(tasks.updatedAt),
      )
      .all();
    result.tasks.push(
      ...projectTasks.map((task) => ({
        key: `project-task-${task.id}`,
        type: "task" as const,
        title: task.title,
        href: canonicalTaskHref(task.id, subjectId),
        subtitle:
          task.status === "done"
            ? "Erledigt"
            : [task.columnName, task.dueDate].filter(Boolean).join(" · "),
        relation: "contains" as const,
      })),
    );
  }

  if (subjectType === "task") {
    const task = db
      .select({
        projectId: tasks.projectId,
        projectName: projects.name,
        projectColor: projects.color,
        parentTaskId: tasks.parentTaskId,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(eq(tasks.id, subjectId))
      .get();
    if (task?.projectId && task.projectName) {
      result.parents.push({
        key: `task-project-${task.projectId}`,
        type: "project",
        title: task.projectName,
        href: canonicalEntityHref("project", task.projectId),
        subtitle: "Projekt",
        relation: "contains",
      });
    }
    if (task?.parentTaskId) {
      const parent = db
        .select({ id: tasks.id, title: tasks.title, projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, task.parentTaskId))
        .get();
      if (parent) {
        result.parents.push({
          key: `parent-task-${parent.id}`,
          type: "task",
          title: parent.title,
          href: canonicalTaskHref(parent.id, parent.projectId),
          subtitle: "Übergeordnete Aufgabe",
          relation: "contains",
        });
      }
    }
  }

  if (subjectType === "wikiPage") {
    const sources = db
      .select({
        id: wikiSources.id,
        title: wikiSources.title,
        relation: wikiPageSources.relation,
      })
      .from(wikiPageSources)
      .innerJoin(wikiSources, eq(wikiPageSources.sourceId, wikiSources.id))
      .where(eq(wikiPageSources.pageId, subjectId))
      .orderBy(asc(wikiSources.title))
      .all();
    result.sources.push(
      ...sources.map((source) => ({
        key: `page-source-${source.id}-${source.relation}`,
        type: "wikiSource" as const,
        title: source.title,
        href: canonicalEntityHref("wikiSource", source.id),
        subtitle:
          source.relation === "citation" ? "Zitiert" : "Unterstützende Quelle",
        relation: "supports" as const,
      })),
    );
  }

  if (subjectType === "wikiSource") {
    const pages = db
      .select({
        id: wikiPages.id,
        title: wikiPages.title,
        slug: wikiPages.slug,
        relation: wikiPageSources.relation,
      })
      .from(wikiPageSources)
      .innerJoin(wikiPages, eq(wikiPageSources.pageId, wikiPages.id))
      .where(eq(wikiPageSources.sourceId, subjectId))
      .orderBy(asc(wikiPages.title))
      .all();
    result.wiki.push(
      ...pages.map((page) => ({
        key: `source-page-${page.id}-${page.relation}`,
        type: "wikiPage" as const,
        title: page.title,
        href: canonicalEntityHref("wikiPage", page.id, { slug: page.slug }),
        subtitle: page.relation === "citation" ? "Zitiert in" : "Verknüpft",
        relation: "supports" as const,
      })),
    );
  }

  if (
    subjectType === "project" ||
    subjectType === "task" ||
    subjectType === "wikiPage"
  ) {
    const evidence = db
      .select({
        id: evidenceLinks.id,
        annotationId: wikiPdfAnnotations.id,
        sourceId: wikiSources.id,
        sourceTitle: wikiSources.title,
        documentId: wikiPdfAnnotations.documentId,
        pageNumber: wikiPdfAnnotations.pageNumber,
        label: wikiPdfAnnotations.label,
        selectedText: wikiPdfAnnotations.selectedText,
      })
      .from(evidenceLinks)
      .innerJoin(
        wikiPdfAnnotations,
        eq(evidenceLinks.annotationId, wikiPdfAnnotations.id),
      )
      .innerJoin(wikiSources, eq(wikiPdfAnnotations.sourceId, wikiSources.id))
      .where(
        and(
          eq(evidenceLinks.targetType, subjectType),
          eq(evidenceLinks.targetId, subjectId),
        ),
      )
      .orderBy(desc(evidenceLinks.createdAt))
      .all();
    result.sources.push(
      ...evidence.map((item) => ({
        key: `evidence-${item.id}`,
        type: "pdf" as const,
        title: item.label || item.sourceTitle,
        href: `/wiki/sources/${item.sourceId}/read/${item.documentId}?page=${item.pageNumber}&annotation=${item.annotationId}`,
        subtitle: `PDF · Seite ${item.pageNumber}${
          item.selectedText ? ` · „${item.selectedText.slice(0, 60)}“` : ""
        }`,
        relation: "evidence" as const,
      })),
    );
  }

  return {
    parents: unique(result.parents),
    tasks: unique(result.tasks),
    wiki: unique(result.wiki),
    sources: unique(result.sources),
  };
}

export function searchKnowledgeCandidates(query: string) {
  const pattern = `%${query.trim()}%`;
  const pageWhere = query.trim()
    ? or(like(wikiPages.title, pattern), like(wikiPages.contentText, pattern))
    : undefined;
  const sourceWhere = query.trim()
    ? or(
        like(wikiSources.title, pattern),
        like(wikiSources.abstract, pattern),
        like(wikiSources.notes, pattern),
      )
    : undefined;

  const pages = db
    .select({ id: wikiPages.id, title: wikiPages.title, slug: wikiPages.slug })
    .from(wikiPages)
    .where(
      pageWhere
        ? and(isNull(wikiPages.deletedAt), pageWhere)
        : isNull(wikiPages.deletedAt),
    )
    .orderBy(desc(wikiPages.updatedAt))
    .limit(8)
    .all()
    .map((page) => ({
      type: "wikiPage" as const,
      id: page.id,
      title: page.title,
      subtitle: "Wiki-Dokument",
      href: canonicalEntityHref("wikiPage", page.id, { slug: page.slug }),
    }));
  const sources = db
    .select({ id: wikiSources.id, title: wikiSources.title })
    .from(wikiSources)
    .where(
      sourceWhere
        ? and(isNull(wikiSources.deletedAt), sourceWhere)
        : isNull(wikiSources.deletedAt),
    )
    .orderBy(desc(wikiSources.updatedAt))
    .limit(8)
    .all()
    .map((source) => ({
      type: "wikiSource" as const,
      id: source.id,
      title: source.title,
      subtitle: "Quelle",
      href: canonicalEntityHref("wikiSource", source.id),
    }));
  const pdfs = db
    .select({
      id: wikiPdfDocuments.id,
      sourceId: wikiSources.id,
      title: wikiSources.title,
    })
    .from(wikiPdfDocuments)
    .innerJoin(wikiSources, eq(wikiPdfDocuments.sourceId, wikiSources.id))
    .where(query.trim() ? like(wikiSources.title, pattern) : undefined)
    .orderBy(desc(wikiPdfDocuments.updatedAt))
    .limit(8)
    .all()
    .map((pdf) => ({
      type: "pdf" as const,
      id: pdf.id,
      title: pdf.title,
      subtitle: "PDF-Dokument",
      href: canonicalEntityHref("pdf", pdf.id, { sourceId: pdf.sourceId }),
    }));
  return [...pages, ...sources, ...pdfs];
}

export function searchWorkCandidates(query: string) {
  const pattern = `%${query.trim()}%`;
  const projectsFound = db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(query.trim() ? like(projects.name, pattern) : eq(projects.status, "active"))
    .orderBy(desc(projects.updatedAt))
    .limit(8)
    .all()
    .map((project) => ({
      type: "project" as const,
      id: project.id,
      title: project.name,
      subtitle: "Projekt",
      href: canonicalEntityHref("project", project.id),
    }));
  const tasksFound = db
    .select({
      id: tasks.id,
      title: tasks.title,
      projectId: tasks.projectId,
      projectName: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(query.trim() ? like(tasks.title, pattern) : eq(tasks.status, "open"))
    .orderBy(desc(tasks.updatedAt))
    .limit(12)
    .all()
    .map((task) => ({
      type: "task" as const,
      id: task.id,
      title: task.title,
      subtitle: task.projectName || "Persönliche Aufgabe",
      href: canonicalTaskHref(task.id, task.projectId),
    }));
  return [...projectsFound, ...tasksFound];
}

export function searchWorkspaceRows(query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const pattern = `%${trimmed}%`;
  const work = searchWorkCandidates(trimmed).map((item) => ({
    ...item,
    path: item.subtitle || "",
  }));
  const knowledge = searchKnowledgeCandidates(trimmed).map((item) => ({
    ...item,
    path: item.subtitle || "",
  }));
  const pdfPages = db
    .select({
      documentId: wikiPdfPages.documentId,
      pageNumber: wikiPdfPages.pageNumber,
      sourceId: wikiSources.id,
      title: wikiSources.title,
    })
    .from(wikiPdfPages)
    .innerJoin(
      wikiPdfDocuments,
      eq(wikiPdfPages.documentId, wikiPdfDocuments.id),
    )
    .innerJoin(wikiSources, eq(wikiPdfDocuments.sourceId, wikiSources.id))
    .where(like(wikiPdfPages.text, pattern))
    .orderBy(desc(wikiPdfPages.createdAt))
    .limit(5)
    .all()
    .map((page) => ({
      type: "pdf" as const,
      id: `${page.documentId}:${page.pageNumber}`,
      title: page.title,
      subtitle: `PDF · Seite ${page.pageNumber}`,
      path: `Quelle › Seite ${page.pageNumber}`,
      href: canonicalEntityHref("pdf", page.documentId, {
        sourceId: page.sourceId,
        pageNumber: page.pageNumber,
      }),
    }));
  return [...work, ...knowledge, ...pdfPages].slice(0, 30);
}
