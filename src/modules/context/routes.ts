import type { ContextEntityType } from "./types";

export function canonicalTaskHref(taskId: string, projectId?: string | null) {
  return projectId
    ? `/projects/${encodeURIComponent(projectId)}?task=${encodeURIComponent(taskId)}`
    : `/?task=${encodeURIComponent(taskId)}`;
}

export function canonicalEntityHref(
  type: ContextEntityType,
  id: string,
  options: {
    projectId?: string | null;
    slug?: string;
    sourceId?: string;
    pageNumber?: number;
  } = {},
) {
  if (type === "project") return `/projects/${encodeURIComponent(id)}`;
  if (type === "task") return canonicalTaskHref(id, options.projectId);
  if (type === "wikiPage") {
    return `/wiki/pages/${encodeURIComponent(options.slug ?? id)}`;
  }
  if (type === "wikiSource") return `/wiki/sources/${encodeURIComponent(id)}`;
  if (type === "pdf") {
    const base = `/wiki/sources/${encodeURIComponent(options.sourceId ?? "")}/read/${encodeURIComponent(id)}`;
    return options.pageNumber ? `${base}?page=${options.pageNumber}` : base;
  }
  return id.startsWith("/") ? id : "/";
}

export function withTaskFocus(route: string, taskId: string) {
  const separator = route.includes("?") ? "&" : "?";
  return `${route}${separator}task=${encodeURIComponent(taskId)}`;
}
