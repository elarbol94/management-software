import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, sqlite } from "@/db";
import {
  user,
  userProfilePreferences,
  wikiCommentThreads,
  wikiComments,
  wikiFavorites,
  wikiNotifications,
  wikiPageRevisions,
  wikiPages,
  wikiPageSources,
  wikiPageTags,
  wikiSourceContributors,
  wikiSourceRevisions,
  wikiSources,
  wikiSourceTags,
  wikiTags,
} from "@/db/schema";
import { getPageTree } from "./queries";
import type { CitationSource, Contributor } from "./lib/citations";
import { resolveStoredUserMarkColor } from "@/lib/user-mark-colors.server";

export type TagDto = { id: string; name: string; color: string };

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
  const tags = db.select().from(wikiTags).orderBy(asc(wikiTags.name)).all();
  return { counts, tags, tree: getPageTree() };
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

export function listSources(
  options: {
    query?: string;
    status?: string;
    tagId?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const where = ["s.deleted_at IS NULL"];
  const params: Array<string | number> = [];
  if (options.query?.trim()) {
    where.push(
      "(s.title LIKE ? OR s.doi LIKE ? OR s.isbn LIKE ? OR EXISTS (SELECT 1 FROM wiki_source_contributors c2 WHERE c2.source_id = s.id AND (c2.family LIKE ? OR c2.literal LIKE ?)))",
    );
    const like = `%${options.query.trim()}%`;
    params.push(like, like, like, like, like);
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
  params.push(options.limit ?? 50, options.offset ?? 0);
  return sqlite
    .prepare(
      `
    SELECT s.id, s.type, s.document_type AS documentType, s.title, s.issued_date AS issuedDate, s.reading_status AS readingStatus,
           s.doi, s.url, s.updated_at AS updatedAt,
           group_concat(DISTINCT CASE WHEN c.literal != '' THEN c.literal ELSE trim(c.given || ' ' || c.family) END) AS contributors,
           group_concat(DISTINCT t.name) AS tags,
           (SELECT count(DISTINCT ps.page_id) FROM wiki_page_sources ps WHERE ps.source_id = s.id AND ps.relation = 'citation') AS citationCount,
           (SELECT count(*) FROM attachments a WHERE a.entity_type = 'wikiSource' AND a.entity_id = s.id) AS attachmentCount
    FROM wiki_sources s
    LEFT JOIN wiki_source_contributors c ON c.source_id = s.id AND c.role = 'author'
    LEFT JOIN wiki_source_tags st ON st.source_id = s.id
    LEFT JOIN wiki_tags t ON t.id = st.tag_id
    WHERE ${where.join(" AND ")}
    GROUP BY s.id ORDER BY s.updated_at DESC LIMIT ? OFFSET ?
  `,
    )
    .all(...params) as SourceListItem[];
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

export function getCitationSourcesForPage(pageId: string): CitationSource[] {
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
    .map((row) => row.source);
  if (rows.length === 0) return [];
  const ids = rows.map((source) => source.id);
  const placeholders = ids.map(() => "?").join(",");
  const contributors = sqlite
    .prepare(
      `SELECT source_id AS sourceId, role, given, family, literal, sort_order AS sortOrder FROM wiki_source_contributors WHERE source_id IN (${placeholders}) ORDER BY sort_order`,
    )
    .all(...ids) as Array<Contributor & { sourceId: string }>;
  return rows.map((source) => ({
    ...source,
    contributors: contributors.filter(
      (person) => person.sourceId === source.id,
    ),
  }));
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
      kind: wikiPageRevisions.kind,
      createdAt: wikiPageRevisions.createdAt,
      createdByName: user.name,
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
  return threads.map((thread) => ({
    ...thread,
    createdByMarkColor: resolveStoredUserMarkColor(thread.createdByMarkColor),
    anchor: thread.anchorType === "image"
      ? { type: "image" as const, nodeId: thread.anchorNodeId ?? "", mode: thread.anchorData.mode ?? "whole", rect: thread.anchorData.rect, label: thread.anchorData.label ?? thread.anchorQuote }
      : thread.anchorType === "text"
        ? { type: "text" as const, quote: thread.anchorQuote }
        : { type: "page" as const },
    comments: db
      .select({
        id: wikiComments.id,
        body: wikiComments.body,
        createdBy: wikiComments.createdBy,
        createdAt: wikiComments.createdAt,
        createdByName: user.name,
        createdByMarkColor: userProfilePreferences.markColor,
      })
      .from(wikiComments)
      .innerJoin(user, eq(wikiComments.createdBy, user.id))
      .leftJoin(userProfilePreferences, eq(wikiComments.createdBy, userProfilePreferences.userId))
      .where(and(eq(wikiComments.threadId, thread.id), isNull(wikiComments.deletedAt)))
      .orderBy(asc(wikiComments.createdAt))
      .all()
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
      actorName: user.name,
      actorMarkColor: userProfilePreferences.markColor,
      pageTitle: wikiPages.title,
      pageSlug: wikiPages.slug,
    })
    .from(wikiNotifications)
    .innerJoin(user, eq(wikiNotifications.actorId, user.id))
    .leftJoin(userProfilePreferences, eq(wikiNotifications.actorId, userProfilePreferences.userId))
    .leftJoin(wikiPages, eq(wikiNotifications.pageId, wikiPages.id))
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
};

export function listWorkspacePages(userId: string): WorkspacePage[] {
  return sqlite
    .prepare(
      `
    SELECT p.id, p.title, p.slug, p.content_text AS contentText, p.status,
           p.citation_locale AS citationLocale, p.updated_at AS updatedAt,
           u.name AS updatedByName, group_concat(DISTINCT t.name) AS tags,
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
