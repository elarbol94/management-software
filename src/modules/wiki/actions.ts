"use server";

import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, sqlite } from "@/db";
import { wikiLinks, wikiPages } from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import { extractInternalSlugs, extractText, slugify } from "./lib/tiptap";
import type { TiptapNode } from "./lib/tiptap";

function uniqueSlug(title: string): string {
  const base = slugify(title);
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const exists = db
      .select({ id: wikiPages.id })
      .from(wikiPages)
      .where(eq(wikiPages.slug, slug))
      .get();
    if (!exists) return slug;
    slug = `${base}-${i}`;
  }
  throw new Error("Could not allocate a unique slug");
}

function syncFts(pageId: string, title: string, contentText: string) {
  sqlite
    .prepare("DELETE FROM wiki_pages_fts WHERE page_id = ?")
    .run(pageId);
  sqlite
    .prepare(
      "INSERT INTO wiki_pages_fts (page_id, title, content_text) VALUES (?, ?, ?)",
    )
    .run(pageId, title, contentText);
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  parentId: z.string().nullable().default(null),
});

export async function createPage(
  input: z.infer<typeof createSchema>,
): Promise<{ slug: string }> {
  const user = await requireUserOrThrow();
  const data = createSchema.parse(input);

  const slug = uniqueSlug(data.title);
  const row = db
    .insert(wikiPages)
    .values({
      title: data.title,
      slug,
      parentId: data.parentId,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning({ id: wikiPages.id })
    .get();

  syncFts(row.id, data.title, "");
  revalidatePath("/wiki", "layout");
  return { slug };
}

export async function renamePage(id: string, title: string) {
  const user = await requireUserOrThrow();
  const cleanTitle = z.string().min(1).max(200).parse(title);

  const page = db.select().from(wikiPages).where(eq(wikiPages.id, id)).get();
  if (!page) throw new Error("Page not found");

  db.update(wikiPages)
    .set({ title: cleanTitle, updatedBy: user.id, updatedAt: new Date() })
    .where(eq(wikiPages.id, id))
    .run();
  syncFts(id, cleanTitle, page.contentText);
  revalidatePath("/wiki", "layout");
}

const saveSchema = z.object({
  id: z.string().min(1),
  contentJson: z.string().max(2_000_000),
});

export async function savePageContent(input: z.infer<typeof saveSchema>) {
  const user = await requireUserOrThrow();
  const data = saveSchema.parse(input);

  const page = db
    .select()
    .from(wikiPages)
    .where(and(eq(wikiPages.id, data.id), isNull(wikiPages.deletedAt)))
    .get();
  // Autosaves can arrive after another request deleted the page. Treat that
  // normal race as a no-op instead of surfacing a server error.
  if (!page) return { saved: false };

  let doc: TiptapNode | null = null;
  try {
    doc = JSON.parse(data.contentJson) as TiptapNode;
  } catch {
    throw new Error("Invalid document");
  }

  const contentText = extractText(doc);
  const slugs = extractInternalSlugs(doc);

  db.transaction(() => {
    db.update(wikiPages)
      .set({
        contentJson: data.contentJson,
        contentText,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(wikiPages.id, data.id))
      .run();

    // Rebuild outgoing links.
    db.delete(wikiLinks).where(eq(wikiLinks.sourcePageId, data.id)).run();
    if (slugs.length > 0) {
      const targets = db
        .select({ id: wikiPages.id })
        .from(wikiPages)
        .where(inArray(wikiPages.slug, slugs))
        .all();
      if (targets.length > 0) {
        db.insert(wikiLinks)
          .values(
            targets
              .filter((target) => target.id !== data.id)
              .map((target) => ({
                sourcePageId: data.id,
                targetPageId: target.id,
              })),
          )
          .onConflictDoNothing()
          .run();
      }
    }

    syncFts(data.id, page.title, contentText);
  });
  // No revalidatePath here: autosave must not re-render the open editor.
  return { saved: true };
}

export async function searchWiki(query: string) {
  await requireUserOrThrow();
  const { searchPages } = await import("./queries");
  return searchPages(z.string().max(200).parse(query));
}

/** Soft-deletes a page and all of its descendants. */
export async function deletePage(id: string) {
  const user = await requireUserOrThrow();

  const all = db
    .select({ id: wikiPages.id, parentId: wikiPages.parentId })
    .from(wikiPages)
    .where(isNull(wikiPages.deletedAt))
    .all();

  const childrenOf = new Map<string | null, string[]>();
  for (const page of all) {
    const list = childrenOf.get(page.parentId) ?? [];
    list.push(page.id);
    childrenOf.set(page.parentId, list);
  }

  const toDelete: string[] = [];
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    toDelete.push(current);
    queue.push(...(childrenOf.get(current) ?? []));
  }

  db.transaction(() => {
    db.update(wikiPages)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(inArray(wikiPages.id, toDelete))
      .run();
    for (const pageId of toDelete) {
      sqlite.prepare("DELETE FROM wiki_pages_fts WHERE page_id = ?").run(pageId);
    }
  });

  revalidatePath("/wiki", "layout");
}
