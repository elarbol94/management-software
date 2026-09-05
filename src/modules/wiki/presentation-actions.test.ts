import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUserOrThrow: vi.fn(async () => ({ id: "author", name: "Author" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/files", () => ({ deleteAttachmentsFor: vi.fn(), getAttachment: vi.fn() }));
vi.mock("@/db", async () => {
  const { default: Database } = await import("better-sqlite3");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { readFileSync } = await import("node:fs");
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT); INSERT INTO user VALUES ('author', 'Author')");
  for (const file of ["0051_wiki_presentations.sql", "0052_wiki_presentation_history.sql", "0055_redundant_nebula.sql"]) {
    sqlite.exec(readFileSync(`drizzle/${file}`, "utf8"));
  }
  return { sqlite, db: drizzle(sqlite) };
});

import { sqlite } from "@/db";
import { acquirePresentationEditLease, createPresentation, releasePresentationEditLease, renamePresentation, restorePresentationRevision, savePresentation } from "./presentation-actions";
import { requireUserOrThrow } from "@/lib/auth";
import { getAttachment } from "@/lib/files";
import { changePresentationStudio } from "./presentation-studio";
import { presentationIdForToken, presentationRole } from "./presentation-access";
import { getPresentation } from "./presentation-queries";
import { publicPresentation, renderPresentationHtml } from "./presentation-delivery";

const sessionId = "editor-session-one";
const record = (id: string) => sqlite.prepare("SELECT * FROM wiki_presentations WHERE id = ?").get(id) as {
  title: string; updated_at: number; elements_json: string;
};
const revisions = (id: string) => sqlite.prepare("SELECT * FROM wiki_presentation_revisions WHERE presentation_id = ? ORDER BY created_at DESC").all(id) as {
  id: string; title: string; elements_json: string;
}[];

beforeEach(() => {
  sqlite.exec("DELETE FROM wiki_presentations; INSERT OR IGNORE INTO user VALUES ('other', 'Other')");
  vi.mocked(requireUserOrThrow).mockResolvedValue({ id: "author", name: "Author" } as Awaited<ReturnType<typeof requireUserOrThrow>>);
});

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

describe("presentation studio access and collaboration", () => {
  it("enforces restricted viewer and commenter permissions on reads and writes", async () => {
    const { id } = await createPresentation({ title: "Private" });
    await changePresentationStudio(id, { action: "access", restricted: true, coediting: false });
    expect(getPresentation(id, { id: "other" })).toBeNull();
    await changePresentationStudio(id, { action: "member", userId: "other", role: "view" });
    expect(presentationRole(id, { id: "other" })).toBe("view");
    vi.mocked(requireUserOrThrow).mockResolvedValue({ id: "other", name: "Other" } as Awaited<ReturnType<typeof requireUserOrThrow>>);
    await expect(savePresentation({ id, elements: [], steps: [] })).rejects.toThrow("access denied");
    await expect(changePresentationStudio(id, { action: "public", enabled: true })).rejects.toThrow("access denied");
    await expect(changePresentationStudio(id, { action: "comment", body: "Unwanted" })).rejects.toThrow("access denied");
    expect(getPresentation(id, { id: "other" })?.title).toBe("Private");
  });

  it("creates revocable public links and does not serialize speaker notes", async () => {
    const { id } = await createPresentation({ title: "Shared", templateId: "pitch" });
    const source = getPresentation(id, { id: "author" })!;
    await savePresentation({ ...source, steps: source.steps.map((step) => ({ ...step, notes: "PRIVATE_SPEAKER_NOTES" })) });
    const result = await changePresentationStudio(id, { action: "public", enabled: true });
    const token = "token" in result ? result.token! : "";
    expect(presentationIdForToken(token)).toBe(id);
    const publicCopy = publicPresentation(token)!;
    expect(JSON.stringify(publicCopy)).not.toContain("PRIVATE_SPEAKER_NOTES");
    const html = renderPresentationHtml(publicCopy, (id) => `/media/${id}`, { previous: "Previous", next: "Next", overview: "Overview", play: "Play", pause: "Pause", fullscreen: "Fullscreen", noSteps: "Empty" }, "en");
    expect(html).toContain("presentation-data"); expect(html).not.toContain("PRIVATE_SPEAKER_NOTES"); expect(html).not.toContain("/_next/");
    await changePresentationStudio(id, { action: "public", enabled: false });
    expect(publicPresentation(token)).toBeNull();
  });

  it("merges simultaneous independent edits but preserves competing edits as conflicts", async () => {
    const { id } = await createPresentation({ title: "Original", templateId: "pitch" });
    await changePresentationStudio(id, { action: "access", restricted: false, coediting: true });
    const base = getPresentation(id, { id: "author" })!;
    const first = await savePresentation({ ...base, title: "New title", expectedUpdatedAt: base.updatedAt, base });
    expect(first).toMatchObject({ conflict: false });
    const second = await savePresentation({ ...base, background: "#123456", expectedUpdatedAt: base.updatedAt, base });
    expect(second).toMatchObject({ conflict: false });
    expect(getPresentation(id, { id: "author" })).toMatchObject({ title: "New title", background: "#123456" });
    const conflicting = await savePresentation({ ...base, title: "Competing title", expectedUpdatedAt: base.updatedAt, base });
    expect(conflicting).toMatchObject({ conflict: true, conflicts: ["title"] });
    expect(getPresentation(id, { id: "author" })?.title).toBe("New title");
    expect(await savePresentation({ ...base })).toMatchObject({ conflict: true });
  });

  it("comments are attached to objects and notes updates preserve the rest of the document", async () => {
    const { id } = await createPresentation({ title: "Notes", templateId: "pitch" });
    const source = getPresentation(id, { id: "author" })!;
    await changePresentationStudio(id, { action: "comment", elementId: source.elements[0].id, body: "Please clarify" });
    expect(sqlite.prepare("SELECT body FROM wiki_presentation_comments WHERE presentation_id = ?").get(id)).toEqual({ body: "Please clarify" });
    await changePresentationStudio(id, { action: "notes", stepId: source.steps[0].id, previous: "", notes: "Presenter revision" });
    const current = getPresentation(id, { id: "author" })!;
    expect(current.elements).toEqual(source.elements); expect(current.steps[0].notes).toBe("Presenter revision");
    expect(revisions(id)).toHaveLength(1);
    expect(await changePresentationStudio(id, { action: "notes", stepId: source.steps[0].id, previous: "", notes: "Stale overwrite" })).toMatchObject({ conflict: true });
  });

  it("rejects new media references from another presentation", async () => {
    const { id } = await createPresentation({ title: "Destination" });
    const image = { id: "image", type: "image", x: 0, y: 0, width: 200, height: 200, rotation: 0, content: { attachmentId: "private", alt: "" } };
    vi.mocked(getAttachment).mockReturnValue({ entityType: "wikiPresentation", entityId: "another-deck", mimeType: "image/png" } as NonNullable<ReturnType<typeof getAttachment>>);
    await expect(savePresentation({ id, elements: [image], steps: [] })).rejects.toThrow("media unavailable");
    vi.mocked(getAttachment).mockReturnValue({ entityType: "wikiPresentation", entityId: id, mimeType: "image/png" } as NonNullable<ReturnType<typeof getAttachment>>);
    expect(await savePresentation({ id, elements: [image], steps: [] })).toMatchObject({ conflict: false });
  });

  it("renders formatted lists and does not draw non-positive pie slices", async () => {
    const { id } = await createPresentation({ title: "Content" });
    const source = getPresentation(id, { id: "author" })!;
    source.elements = [
      { id: "text", type: "text", x: 0, y: 0, width: 300, height: 150, rotation: 0, content: { text: "Bold\nPlain", runs: [{ text: "Bold", bold: true }, { text: "\nPlain" }], list: "bullet", fontSize: 24, bold: false, align: "left", color: "" } },
      { id: "pie", type: "chart", x: 0, y: 200, width: 300, height: 200, rotation: 0, content: { kind: "pie", title: "Empty", data: [{ label: "Zero", value: 0 }, { label: "Negative", value: -10 }], color: "#6366f1" } },
    ];
    const html = renderPresentationHtml(source, (id) => `/media/${id}`, { previous: "Previous", next: "Next", overview: "Overview", play: "Play", pause: "Pause", fullscreen: "Fullscreen", noSteps: "Empty" }, "en");
    expect(html).toContain('font-weight:700'); expect(html).toContain('• ');
    expect(html).not.toContain('<path'); expect(html).toContain('Negative');
  });
});
