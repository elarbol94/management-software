import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, sqlite } from "@/db";
import {
  user,
  userProfilePreferences,
  taskContexts,
  tasks,
  wikiCommentThreads,
  wikiComments,
  wikiFavorites,
  wikiNotifications,
  wikiPageRevisions,
  wikiPages,
  wikiPageSources,
  wikiPageTags,
  wikiPdfDocuments,
  wikiSourceContributors,
  wikiSourceRevisions,
  wikiSources,
  wikiSourceTags,
  wikiTags,
} from "@/db/schema";
import { getPageTree } from "./queries";
import { buildFtsQuery } from "./lib/tiptap";
import type { CitationSource, CitationStyle, Contributor } from "./lib/citations";
import { decorateCitationSource } from "./lib/citations.server";
import { resolveStoredUserMarkColor } from "@/lib/user-mark-colors.server";
import { measureServerOperation } from "@/lib/performance-server";

export type TagDto = { id: string; name: string; color: string };

export type KnowledgeLaunchpadItem = {
  id: string;
  title: string;
  href: string;
  updatedAt: number;
  kind: "document" | "source";
  status: string;
};

export function getKnowledgeLaunchpad() {
  const documents = sqlite.prepare(`
    SELECT id, title, slug, status, updated_at AS updatedAt
    FROM wiki_pages
    WHERE deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC
    LIMIT 6
  `).all() as Array<{ id: string; title: string; slug: string; status: string; updatedAt: number }>;

  const sources = sqlite.prepare(`
    SELECT s.id, s.title, s.reading_status AS status, s.updated_at AS updatedAt,
      (SELECT d.id FROM wiki_pdf_documents d
       WHERE d.source_id = s.id AND d.status = 'ready'
       ORDER BY CASE WHEN d.role = 'primary' THEN 0 ELSE 1 END, d.created_at ASC
       LIMIT 1) AS documentId
    FROM wiki_sources s
    WHERE s.deleted_at IS NULL AND s.reading_status IN ('reading', 'read')
    ORDER BY CASE WHEN s.reading_status = 'reading' THEN 0 ELSE 1 END,
      s.updated_at DESC, s.id DESC
    LIMIT 6
  `).all() as Array<{ id: string; title: string; status: string; updatedAt: number; documentId: string | null }>;

  return {
    documents: documents.map((item): KnowledgeLaunchpadItem => ({
      id: item.id,
      title: item.title,
      href: `/wiki/pages/${item.slug}`,
      updatedAt: item.updatedAt,
      kind: "document",
      status: item.status,
    })),
    sources: sources.map((item): KnowledgeLaunchpadItem => ({
      id: item.id,
      title: item.title,
      href: item.documentId
        ? `/wiki/sources/${item.id}/read/${item.documentId}`
        : `/wiki/sources/${item.id}`,
      updatedAt: item.updatedAt,
      kind: "source",
      status: item.status,
    })),
  };
}

export function getResearchNavigation(userId: string) {
  const counts = sqlite
    .prepare(
      `
    SELECT
      (SELECT count(*) FROM wiki_pages WHERE deleted_at IS NULL AND status = 'inbox') AS inbox,
      (SELECT count(*) FROM wiki_sources WHERE deleted_at IS NULL) AS sources,
      (SELECT count(*) FROM wiki_notifications WHERE user_id = ? AND read_at IS NULL) AS unread,
      ((SELECT count(*) FROM wiki_pages WHERE deleted_at IS NOT NULL) +
       (SELECT count(*) FROM wiki_sources WHERE deleted_at IS NOT NULL)) AS trash
  `,
    )
    .get(userId) as {
    inbox: number;
    sources: number;
    unread: number;
    trash: number;
  };
  const tags = listTags();
  return { counts, tags, tree: getPageTree() };
}

export function listTags() {
  return db.select().from(wikiTags).orderBy(asc(wikiTags.name)).all();
}

export function listInboxPages() {
  return sqlite
    .prepare(
      `
    SELECT p.id, p.title, p.slug, p.content_text AS contentText, p.updated_at AS updatedAt,
           u.name AS updatedByName,
           group_concat(DISTINCT t.name) AS tags
    FROM wiki_pages p
    JOIN user u ON u.id = p.updated_by
    LEFT JOIN wiki_page_tags pt ON pt.page_id = p.id
    LEFT JOIN wiki_tags t ON t.id = pt.tag_id
    WHERE p.deleted_at IS NULL AND p.status = 'inbox'
    GROUP BY p.id ORDER BY p.updated_at DESC
  `,
    )
    .all() as Array<{
    id: string;
    title: string;
    slug: string;
    contentText: string;
    updatedAt: number;
    updatedByName: string;
    tags: string | null;
  }>;
}

export type SourceListItem = {
  id: string;
  type: string;
  documentType: string;
  title: string;
  issuedDate: string;
  readingStatus: string;
  doi: string;
  url: string;
  updatedAt: number;
  contributors: string;
  tags: string | null;
  citationCount: number;
  attachmentCount: number;
};

function decodeSourceCursor(cursor?: string) {
  if (!cursor) return null;
  try {
    const [updatedAt, id] = Buffer.from(cursor, "base64url")
      .toString("utf8")
      .split(":");
    const timestamp = Number(updatedAt);
    if (!Number.isSafeInteger(timestamp) || !id) return null;
    return { updatedAt: timestamp, id };
  } catch {
    return null;
  }
}

function encodeSourceCursor(source: SourceListItem) {
  return Buffer.from(`${source.updatedAt}:${source.id}`).toString("base64url");
}

export function listSources(
  options: {
    query?: string;
    status?: string;
    tagId?: string;
    limit?: number;
    offset?: number;
    cursor?: string;
  } = {},
) {
  const where = ["s.deleted_at IS NULL"];
  const params: Array<string | number> = [];
  if (options.query?.trim()) {
    // The library list used to search titles and identifiers with LIKE only, so a word
    // that lived in an abstract or in notes was findable from the sidebar search and
    // returned nothing here. Search the same FTS index the sidebar uses, and keep LIKE
    // alongside it for partial identifiers, which prefix-matching alone would miss.
    const like = `%${options.query.trim()}%`;
    const fts = buildFtsQuery(options.query);
    const clauses = [
      "s.title LIKE ?",
      "s.doi LIKE ?",
      "s.isbn LIKE ?",
      "EXISTS (SELECT 1 FROM wiki_source_contributors c2 WHERE c2.source_id = s.id AND (c2.family LIKE ? OR c2.literal LIKE ?))",
    ];
    params.push(like, like, like, like, like);
    if (fts) {
      clauses.push("s.id IN (SELECT source_id FROM wiki_sources_fts WHERE wiki_sources_fts MATCH ?)");
      params.push(fts);
    }
    where.push(`(${clauses.join(" OR ")})`);
  }
  if (options.status) {
    where.push("s.reading_status = ?");
    params.push(options.status);
  }
  if (options.tagId) {
    where.push(
      "EXISTS (SELECT 1 FROM wiki_source_tags st2 WHERE st2.source_id = s.id AND st2.tag_id = ?)",
    );
    params.push(options.tagId);
  }
  const cursor = decodeSourceCursor(options.cursor);
  if (cursor) {
    where.push("(s.updated_at < ? OR (s.updated_at = ? AND s.id < ?))");
    params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }
  params.push(options.limit ?? 50, options.offset ?? 0);
  return sqlite
    .prepare(
      `
    SELECT s.id, s.type, s.document_type AS documentType, s.title, s.issued_date AS issuedDate, s.reading_status AS readingStatus,
           s.doi, s.url, s.updated_at AS updatedAt,
           group_concat(DISTINCT CASE WHEN c.literal != '' THEN c.literal ELSE trim(c.given || ' ' || c.family) END) AS contributors,
           group_concat(DISTINCT t.id || ':' || t.name) AS tags,
           (SELECT count(DISTINCT ps.page_id) FROM wiki_page_sources ps WHERE ps.source_id = s.id AND ps.relation = 'citation') AS citationCount,
           (SELECT count(*) FROM attachments a WHERE a.entity_type = 'wikiSource' AND a.entity_id = s.id) AS attachmentCount
    FROM wiki_sources s
    LEFT JOIN wiki_source_contributors c ON c.source_id = s.id AND c.role = 'author'
    LEFT JOIN wiki_source_tags st ON st.source_id = s.id
    LEFT JOIN wiki_tags t ON t.id = st.tag_id
    WHERE ${where.join(" AND ")}
    GROUP BY s.id ORDER BY s.updated_at DESC, s.id DESC LIMIT ? OFFSET ?
  `,
    )
    .all(...params) as SourceListItem[];
}

export function listSourcesPage(
  options: {
    query?: string;
    status?: string;
    tagId?: string;
    cursor?: string;
    limit?: number;
  } = {},
) {
  return measureServerOperation("/wiki/sources", "list-sources-page", () => {
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const rows = listSources({ ...options, limit: limit + 1, offset: 0 });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      nextCursor: hasMore
        ? encodeSourceCursor(items[items.length - 1])
        : null,
    };
  });
}

export function listDocumentTypes() {
  return sqlite
    .prepare(
      "SELECT DISTINCT document_type AS value FROM wiki_sources WHERE deleted_at IS NULL AND document_type != char(39)||char(39) ORDER BY document_type COLLATE NOCASE",
    )
    .all() as Array<{ value: string }>;
}

export function getSourceById(id: string) {
  const source = db
    .select()
    .from(wikiSources)
    .where(and(eq(wikiSources.id, id), isNull(wikiSources.deletedAt)))
    .get();
  if (!source) return null;
  const contributors = db
    .select()
    .from(wikiSourceContributors)
    .where(eq(wikiSourceContributors.sourceId, id))
    .orderBy(asc(wikiSourceContributors.sortOrder))
    .all();
  const tags = db
    .select({ id: wikiTags.id, name: wikiTags.name, color: wikiTags.color })
    .from(wikiSourceTags)
    .innerJoin(wikiTags, eq(wikiSourceTags.tagId, wikiTags.id))
    .where(eq(wikiSourceTags.sourceId, id))
    .orderBy(asc(wikiTags.name))
    .all();
  const pages = db
    .select({
      id: wikiPages.id,
      title: wikiPages.title,
      slug: wikiPages.slug,
      relation: wikiPageSources.relation,
    })
    .from(wikiPageSources)
    .innerJoin(wikiPages, eq(wikiPageSources.pageId, wikiPages.id))
    .where(and(eq(wikiPageSources.sourceId, id), isNull(wikiPages.deletedAt)))
    .all();
  const revisions = db
    .select({
      id: wikiSourceRevisions.id,
      version: wikiSourceRevisions.version,
      createdAt: wikiSourceRevisions.createdAt,
      createdByName: user.name,
    })
    .from(wikiSourceRevisions)
    .innerJoin(user, eq(wikiSourceRevisions.createdBy, user.id))
    .where(eq(wikiSourceRevisions.sourceId, id))
    .orderBy(desc(wikiSourceRevisions.createdAt))
    .limit(20)
    .all();
  return { source, contributors, tags, pages, revisions };
}

export function getCitationSourcesForPage(pageId: string, locale = "en-US", style: CitationStyle = "ieee"): CitationSource[] {
  const pageContent = db.select({ contentJson: wikiPages.contentJson }).from(wikiPages).where(eq(wikiPages.id, pageId)).get()?.contentJson ?? "";
  const citationOrder: string[] = [];
  try {
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const value = node as { type?: unknown; attrs?: { items?: unknown }; content?: unknown };
      if (value.type === "citation" && Array.isArray(value.attrs?.items)) {
        for (const item of value.attrs.items as Array<{ sourceId?: unknown }>) {
          if (typeof item.sourceId === "string" && !citationOrder.includes(item.sourceId)) citationOrder.push(item.sourceId);
        }
      }
      if (Array.isArray(value.content)) value.content.forEach(visit);
    };
    visit(JSON.parse(pageContent));
  } catch {
    // Legacy or damaged content falls back to the relation-table order.
  }
  const rows = db
    .select({ source: wikiSources })
    .from(wikiPageSources)
    .innerJoin(wikiSources, eq(wikiPageSources.sourceId, wikiSources.id))
    .where(
      and(
        eq(wikiPageSources.pageId, pageId),
        eq(wikiPageSources.relation, "citation"),
      ),
    )
    .all()
    .map((row) => row.source)
    .sort((left, right) => {
      const leftIndex = citationOrder.indexOf(left.id);
      const rightIndex = citationOrder.indexOf(right.id);
      if (leftIndex < 0) return rightIndex < 0 ? 0 : 1;
      if (rightIndex < 0) return -1;
      return leftIndex - rightIndex;
    });
  if (rows.length === 0) return [];
  const ids = rows.map((source) => source.id);
  const placeholders = ids.map(() => "?").join(",");
  const contributors = sqlite
    .prepare(
      `SELECT source_id AS sourceId, role, given, family, literal, sort_order AS sortOrder FROM wiki_source_contributors WHERE source_id IN (${placeholders}) ORDER BY sort_order`,
    )
    .all(...ids) as Array<Contributor & { sourceId: string }>;
  const documents = db
    .select({ id: wikiPdfDocuments.id, sourceId: wikiPdfDocuments.sourceId })
    .from(wikiPdfDocuments)
    .where(inArray(wikiPdfDocuments.sourceId, ids))
    .orderBy(desc(wikiPdfDocuments.version))
    .all();
  return rows.map((source) => decorateCitationSource({
    ...source,
    contributors: contributors.filter(
      (person) => person.sourceId === source.id,
    ),
    pdfDocumentId: documents.find((document) => document.sourceId === source.id)?.id,
  }, locale, style));
}

export function listCitationSources(locale = "en-US", limit = 500, style: CitationStyle = "ieee"): CitationSource[] {
  const rows = db
    .select()
    .from(wikiSources)
    .where(isNull(wikiSources.deletedAt))
    .orderBy(asc(wikiSources.title))
    .limit(limit)
    .all();
  if (!rows.length) return [];
  const contributors = db
    .select()
    .from(wikiSourceContributors)
    .where(inArray(wikiSourceContributors.sourceId, rows.map((source) => source.id)))
    .orderBy(asc(wikiSourceContributors.sortOrder))
    .all();
  const documents = db
    .select({ id: wikiPdfDocuments.id, sourceId: wikiPdfDocuments.sourceId })
    .from(wikiPdfDocuments)
    .where(inArray(wikiPdfDocuments.sourceId, rows.map((source) => source.id)))
    .orderBy(desc(wikiPdfDocuments.version))
    .all();
  return rows.map((source) => decorateCitationSource({
    ...source,
    contributors: contributors.filter((person) => person.sourceId === source.id),
    pdfDocumentId: documents.find((document) => document.sourceId === source.id)?.id,
  }, locale, style));
}

export function getPageResearchMeta(pageId: string, userId: string) {
  const tags = db
    .select({ id: wikiTags.id, name: wikiTags.name, color: wikiTags.color })
    .from(wikiPageTags)
    .innerJoin(wikiTags, eq(wikiPageTags.tagId, wikiTags.id))
    .where(eq(wikiPageTags.pageId, pageId))
    .orderBy(asc(wikiTags.name))
    .all();
  const supportingSources = db
    .select({
      id: wikiSources.id,
      title: wikiSources.title,
      issuedDate: wikiSources.issuedDate,
      relation: wikiPageSources.relation,
    })
    .from(wikiPageSources)
    .innerJoin(wikiSources, eq(wikiPageSources.sourceId, wikiSources.id))
    .where(
      and(
        eq(wikiPageSources.pageId, pageId),
        eq(wikiPageSources.relation, "supporting"),
        // A Literaturstelle in the trash is gone from the library, so it must not
        // keep sitting in the page's sidebar linking to a deleted record.
        isNull(wikiSources.deletedAt),
      ),
    )
    .all();
  const favorite = Boolean(
    db
      .select({ userId: wikiFavorites.userId })
      .from(wikiFavorites)
      .where(
        and(
          eq(wikiFavorites.userId, userId),
          eq(wikiFavorites.entityType, "page"),
          eq(wikiFavorites.entityId, pageId),
        ),
      )
      .get(),
  );
  const revisions = db
    .select({
      id: wikiPageRevisions.id,
      version: wikiPageRevisions.version,
      contentVersion: wikiPageRevisions.contentVersion,
      contentHash: wikiPageRevisions.contentHash,
      label: wikiPageRevisions.label,
      kind: wikiPageRevisions.kind,
      createdAt: wikiPageRevisions.createdAt,
      createdByName: user.name,
      contentJson: wikiPageRevisions.contentJson,
    })
    .from(wikiPageRevisions)
    .innerJoin(user, eq(wikiPageRevisions.createdBy, user.id))
    .where(eq(wikiPageRevisions.pageId, pageId))
    .orderBy(desc(wikiPageRevisions.createdAt))
    .limit(30)
    .all();
  return { tags, supportingSources, favorite, revisions };
}

export function getPageComments(pageId: string) {
  const threads = db
    .select({
      id: wikiCommentThreads.id,
      anchorQuote: wikiCommentThreads.anchorQuote,
      anchorType: wikiCommentThreads.anchorType,
      anchorNodeId: wikiCommentThreads.anchorNodeId,
      anchorData: wikiCommentThreads.anchorData,
      orphaned: wikiCommentThreads.orphaned,
      resolvedAt: wikiCommentThreads.resolvedAt,
      assigneeId: wikiCommentThreads.assigneeId,
      createdAt: wikiCommentThreads.createdAt,
      createdBy: wikiCommentThreads.createdBy,
      createdByName: user.name,
      createdByMarkColor: userProfilePreferences.markColor,
    })
    .from(wikiCommentThreads)
    .innerJoin(user, eq(wikiCommentThreads.createdBy, user.id))
    .leftJoin(userProfilePreferences, eq(wikiCommentThreads.createdBy, userProfilePreferences.userId))
    .where(eq(wikiCommentThreads.pageId, pageId))
    .orderBy(desc(wikiCommentThreads.createdAt))
    .all();
  if (threads.length === 0) return [];

  const commentRows = db
    .select({
      id: wikiComments.id,
      threadId: wikiComments.threadId,
      body: wikiComments.body,
      createdBy: wikiComments.createdBy,
      createdAt: wikiComments.createdAt,
      createdByName: user.name,
      createdByMarkColor: userProfilePreferences.markColor,
    })
    .from(wikiComments)
    .innerJoin(user, eq(wikiComments.createdBy, user.id))
    .leftJoin(
      userProfilePreferences,
      eq(wikiComments.createdBy, userProfilePreferences.userId),
    )
    .where(
      and(
        inArray(
          wikiComments.threadId,
          threads.map((thread) => thread.id),
        ),
        isNull(wikiComments.deletedAt),
      ),
    )
    .orderBy(asc(wikiComments.createdAt))
    .all();
  const commentsByThread = new Map<string, typeof commentRows>();
  for (const comment of commentRows) {
    const current = commentsByThread.get(comment.threadId) ?? [];
    current.push(comment);
    commentsByThread.set(comment.threadId, current);
  }

  return threads.map((thread) => ({
    ...thread,
    createdByMarkColor: resolveStoredUserMarkColor(thread.createdByMarkColor),
    anchor: thread.anchorType === "image"
      ? { type: "image" as const, nodeId: thread.anchorNodeId ?? "", mode: thread.anchorData.mode ?? "whole", rect: thread.anchorData.rect, label: thread.anchorData.label ?? thread.anchorQuote }
      : thread.anchorType === "text"
        ? { type: "text" as const, quote: thread.anchorQuote }
        : { type: "page" as const },
    comments: (commentsByThread.get(thread.id) ?? [])
      .map((comment) => ({
        ...comment,
        createdByMarkColor: resolveStoredUserMarkColor(comment.createdByMarkColor),
      })),
  })).filter((thread) => thread.comments.length > 0);
}

export function listFavorites(userId: string) {
  return sqlite
    .prepare(
      `
    SELECT f.entity_type AS entityType, f.entity_id AS entityId,
           CASE WHEN f.entity_type = 'page' THEN p.title ELSE s.title END AS title,
           p.slug AS slug, s.type AS sourceType, f.created_at AS createdAt
    FROM wiki_favorites f
    LEFT JOIN wiki_pages p ON f.entity_type = 'page' AND p.id = f.entity_id AND p.deleted_at IS NULL
    LEFT JOIN wiki_sources s ON f.entity_type = 'source' AND s.id = f.entity_id AND s.deleted_at IS NULL
    WHERE f.user_id = ? AND (p.id IS NOT NULL OR s.id IS NOT NULL)
    ORDER BY f.created_at DESC
  `,
    )
    .all(userId) as Array<{
    entityType: "page" | "source";
    entityId: string;
    title: string;
    slug: string | null;
    sourceType: string | null;
    createdAt: number;
  }>;
}

export function listNotifications(userId: string) {
  return db
    .select({
      id: wikiNotifications.id,
      type: wikiNotifications.type,
      readAt: wikiNotifications.readAt,
      createdAt: wikiNotifications.createdAt,
      pageId: wikiNotifications.pageId,
      threadId: wikiNotifications.threadId,
      taskId: wikiNotifications.taskId,
      actorName: user.name,
      actorMarkColor: userProfilePreferences.markColor,
      pageTitle: wikiPages.title,
      pageSlug: wikiPages.slug,
      taskTitle: tasks.title,
      taskKind: tasks.kind,
      taskRoute: taskContexts.route,
    })
    .from(wikiNotifications)
    .innerJoin(user, eq(wikiNotifications.actorId, user.id))
    .leftJoin(userProfilePreferences, eq(wikiNotifications.actorId, userProfilePreferences.userId))
    .leftJoin(wikiPages, eq(wikiNotifications.pageId, wikiPages.id))
    .leftJoin(tasks, eq(wikiNotifications.taskId, tasks.id))
    .leftJoin(taskContexts, eq(wikiNotifications.taskId, taskContexts.taskId))
    .where(eq(wikiNotifications.userId, userId))
    .orderBy(desc(wikiNotifications.createdAt))
    .limit(100)
    .all()
    .map((notification) => ({
      ...notification,
      actorMarkColor: resolveStoredUserMarkColor(notification.actorMarkColor),
    }));
}

export function listTrash() {
  const pages = db
    .select({
      id: wikiPages.id,
      title: wikiPages.title,
      deletedAt: wikiPages.deletedAt,
    })
    .from(wikiPages)
    .where(isNotNull(wikiPages.deletedAt))
    .orderBy(desc(wikiPages.deletedAt))
    .all();
  const sources = db
    .select({
      id: wikiSources.id,
      title: wikiSources.title,
      deletedAt: wikiSources.deletedAt,
    })
    .from(wikiSources)
    .where(isNotNull(wikiSources.deletedAt))
    .orderBy(desc(wikiSources.deletedAt))
    .all();
  return { pages, sources };
}

export function listByTag(tagId: string) {
  const tag = db.select().from(wikiTags).where(eq(wikiTags.id, tagId)).get();
  if (!tag) return null;
  const pages = db
    .select({
      id: wikiPages.id,
      title: wikiPages.title,
      slug: wikiPages.slug,
      status: wikiPages.status,
      updatedAt: wikiPages.updatedAt,
    })
    .from(wikiPageTags)
    .innerJoin(wikiPages, eq(wikiPageTags.pageId, wikiPages.id))
    .where(and(eq(wikiPageTags.tagId, tagId), isNull(wikiPages.deletedAt)))
    .all();
  const sources = db
    .select({
      id: wikiSources.id,
      title: wikiSources.title,
      type: wikiSources.type,
      issuedDate: wikiSources.issuedDate,
    })
    .from(wikiSourceTags)
    .innerJoin(wikiSources, eq(wikiSourceTags.sourceId, wikiSources.id))
    .where(and(eq(wikiSourceTags.tagId, tagId), isNull(wikiSources.deletedAt)))
    .all();
  return { tag, pages, sources };
}

export function listUsers() {
  return db
    .select({ id: user.id, name: user.name, markColor: userProfilePreferences.markColor })
    .from(user)
    .leftJoin(userProfilePreferences, eq(user.id, userProfilePreferences.userId))
    .orderBy(asc(user.name))
    .all()
    .map((person) => ({ ...person, markColor: resolveStoredUserMarkColor(person.markColor) }));
}
export type WorkspacePage = {
  id: string;
  title: string;
  slug: string;
  contentText: string;
  status: "inbox" | "working" | "evergreen";
  citationLocale: "de-DE" | "en-US";
  updatedAt: number;
  updatedByName: string;
  tags: string | null;
  favorite: boolean;
  parentId: string | null;
  sortOrder: number;
  createdAt: number;
};

export function listWorkspacePages(userId: string): WorkspacePage[] {
  return sqlite
    .prepare(
      `
    SELECT p.id, p.title, p.slug, p.content_text AS contentText, p.status,
           p.citation_locale AS citationLocale, p.updated_at AS updatedAt,
           p.parent_id AS parentId, p.sort_order AS sortOrder, p.created_at AS createdAt,
           u.name AS updatedByName, group_concat(DISTINCT t.id || ':' || t.name) AS tags,
           EXISTS(
             SELECT 1 FROM wiki_favorites f
             WHERE f.user_id = ? AND f.entity_type = 'page' AND f.entity_id = p.id
           ) AS favorite
    FROM wiki_pages p
    JOIN user u ON u.id = p.updated_by
    LEFT JOIN wiki_page_tags pt ON pt.page_id = p.id
    LEFT JOIN wiki_tags t ON t.id = pt.tag_id
    WHERE p.deleted_at IS NULL
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `,
    )
    .all(userId)
    .map((page) => {
      const result = page as Omit<WorkspacePage, "favorite"> & {
        favorite: number;
      };
      return { ...result, favorite: Boolean(result.favorite) };
    }) as WorkspacePage[];
}
