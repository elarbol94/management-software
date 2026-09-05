import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUserOrThrow: vi.fn(async () => ({ id: "author", name: "Author" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/files", () => ({ deleteAttachmentsFor: vi.fn() }));
vi.mock("@/db", async () => {
  const { default: Database } = await import("better-sqlite3");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { readFileSync } = await import("node:fs");
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT); INSERT INTO user VALUES ('author', 'Author')");
  for (const file of ["0051_wiki_presentations.sql", "0052_wiki_presentation_history.sql"]) {
    sqlite.exec(readFileSync(`drizzle/${file}`, "utf8"));
  }
  return { sqlite, db: drizzle(sqlite) };
});

import { sqlite } from "@/db";
import { acquirePresentationEditLease, createPresentation, releasePresentationEditLease, renamePresentation, restorePresentationRevision, savePresentation } from "./presentation-actions";

const sessionId = "editor-session-one";
const record = (id: string) => sqlite.prepare("SELECT * FROM wiki_presentations WHERE id = ?").get(id) as {
  title: string; updated_at: number; elements_json: string;
};
const revisions = (id: string) => sqlite.prepare("SELECT * FROM wiki_presentation_revisions WHERE presentation_id = ? ORDER BY created_at DESC").all(id) as {
  id: string; title: string; elements_json: string;
}[];

beforeEach(() => { sqlite.exec("DELETE FROM wiki_presentations"); });

describe("presentation saves and history", () => {
  it("saves the title and canvas together and snapshots their previous values", async () => {
    const { id } = await createPresentation({ title: "Original", templateId: "pitch" });
    const previous = record(id);
    await acquirePresentationEditLease({ id, sessionId });
    const result = await savePresentation({ id, sessionId, elements: [], steps: [], title: "Renamed", expectedUpdatedAt: previous.updated_at });
    expect(result).toMatchObject({ locked: false, conflict: false });
    expect(record(id).title).toBe("Renamed");
    expect(record(id).updated_at).toBeGreaterThan(previous.updated_at);
    expect(revisions(id)[0]).toMatchObject({ title: "Original", elements_json: previous.elements_json });
  });

  it("rejects an older canvas even after its tab obtains the lease again", async () => {
    const { id } = await createPresentation({ title: "Original" });
    const previous = record(id);
    const first = await savePresentation({ id, elements: [], steps: [], title: "Latest", expectedUpdatedAt: previous.updated_at });
    expect(first).toMatchObject({ conflict: false });
    await acquirePresentationEditLease({ id, sessionId });
    const stale = await savePresentation({ id, sessionId, elements: [], steps: [], title: "Stale", expectedUpdatedAt: previous.updated_at });
    expect(stale).toMatchObject({ conflict: true });
    expect(record(id).title).toBe("Latest");
  });

  it("does not bypass an active lease by omitting the session", async () => {
    const { id } = await createPresentation({ title: "Original" });
    await acquirePresentationEditLease({ id, sessionId });
    expect(await savePresentation({ id, elements: [], steps: [] })).toMatchObject({ locked: true });
    await expect(renamePresentation({ id, title: "Unwanted" })).rejects.toThrow("locked");
    expect(record(id).title).toBe("Original");
  });

  it("restores all canvas values and retains the replaced state as a recoverable revision", async () => {
    const { id } = await createPresentation({ title: "Original", templateId: "pitch" });
    await acquirePresentationEditLease({ id, sessionId });
    await savePresentation({ id, sessionId, title: "Changed", elements: [], steps: [], background: "#123456" });
    const revision = revisions(id)[0];
    const result = await restorePresentationRevision({ revisionId: revision.id, sessionId, expectedUpdatedAt: record(id).updated_at });
    expect(result.snapshot.title).toBe("Original");
    expect(result.snapshot.elements.length).toBeGreaterThan(0);
    expect(result.snapshot.background).toBe("");
    expect(record(id).title).toBe("Original");
    expect(revisions(id).some((entry) => entry.title === "Changed")).toBe(true);
  });

  it("refuses a restore from a tab that lost its lease or has an outdated version", async () => {
    const { id } = await createPresentation({ title: "Original" });
    await acquirePresentationEditLease({ id, sessionId });
    await savePresentation({ id, sessionId, title: "Changed", elements: [], steps: [] });
    const revisionId = revisions(id)[0].id;
    await expect(restorePresentationRevision({ revisionId })).rejects.toThrow("locked");
    await expect(restorePresentationRevision({ revisionId, sessionId, expectedUpdatedAt: 0 })).rejects.toThrow("changed");
    await releasePresentationEditLease({ id, sessionId });
    expect(record(id).title).toBe("Changed");
  });
});
