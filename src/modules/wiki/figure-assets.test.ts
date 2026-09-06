import { afterAll, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));
vi.mock("./svg-assets", () => ({ listSvgAssets: () => [], renderSvgAsset: () => null }));
vi.mock("@/db", async () => {
  const { default: Database } = await import("better-sqlite3");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const sqlite = new Database(":memory:"); sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite); migrate(db, { migrationsFolder: "drizzle" });
  sqlite.exec("INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,role) VALUES ('author','Author','figure@example.test',1,0,0,'admin')");
  sqlite.exec("INSERT INTO wiki_pages (id,title,slug,created_by,updated_by,created_at,updated_at) VALUES ('page','Figures','figures','author','author',0,0)");
  return { sqlite, db };
});
const testRoot = vi.hoisted(() => {
  // File storage is isolated before the file helper is loaded.
  const original = process.env.UPLOADS_PATH;
  process.env.UPLOADS_PATH = `${process.env.TEMP || process.env.TMP || "/tmp"}/wiki-figures-test-${crypto.randomUUID()}`;
  return { original, uploads: process.env.UPLOADS_PATH };
});
import { db, sqlite } from "@/db";
import { wikiFigureAssets, wikiFigureRevisions } from "@/db/schema";
import { changeFigureAsset, createFigureSource, figureAsset, figureManifest, figureRevisionBytes, publishFigure, syncServerFigure } from "./figure-assets";
import { resolveFigureServerPath } from "./lib/figure-server-path";
import * as serverPaths from "./lib/figure-server-path";

const sourceFolder = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-figures-test-"));
const svg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="${color}"/></svg>`;
const file = (color: string) => new File([svg(color)], "plot.svg", { type: "image/svg+xml" });
beforeEach(() => { sqlite.exec("DELETE FROM wiki_figure_revisions; DELETE FROM wiki_figure_assets; DELETE FROM wiki_figure_sources;"); process.env.WIKI_FIGURE_ROOTS = JSON.stringify({ research: sourceFolder }); });
afterAll(() => {
  sqlite.close();
  for (const directory of [sourceFolder, testRoot.uploads]) {
    const target = path.resolve(directory);
    if (!target.startsWith(path.join(os.tmpdir(), "wiki-figures-test-"))) throw new Error("Unexpected test directory");
    fs.rmSync(target, { recursive: true, force: true });
  }
  if (testRoot.original === undefined) delete process.env.UPLOADS_PATH; else process.env.UPLOADS_PATH = testRoot.original;
  delete process.env.WIKI_FIGURE_ROOTS;
});
it("publishes immutable versions without changing document content, and skips identical data", async () => {
  const source = createFigureSource("page", "author", { kind: "laptop", name: "Research" });
  const first = await publishFigure({ pageId: "page", userId: "author", sourceId: source.id, relativePath: "plot.svg", file: file("red") });
  const second = await publishFigure({ pageId: "page", userId: "author", sourceId: source.id, relativePath: "plot.svg", expectedVersion: 1, file: file("blue") });
  expect(second.id).toBe(first.id); expect(second.version).toBe(2);
  expect(Buffer.from((await figureRevisionBytes("page", first.id, 1)).bytes).toString()).toContain('fill="red"');
  expect(Buffer.from((await figureRevisionBytes("page", first.id)).bytes).toString()).toContain('fill="blue"');
  await publishFigure({ pageId: "page", userId: "author", sourceId: source.id, relativePath: "plot.svg", expectedVersion: 2, file: file("blue") });
  expect(db.select().from(wikiFigureRevisions).where(eq(wikiFigureRevisions.assetId, first.id)).all()).toHaveLength(2);
  expect(sqlite.prepare("SELECT content_version FROM wiki_pages WHERE id='page'").get()).toEqual({ content_version: 1 });
});
it("separates source folders and rejects stale and unauthorized updates", async () => {
  const one = createFigureSource("page", "author", { kind: "laptop", name: "One" });
  const two = createFigureSource("page", "author", { kind: "laptop", name: "Two" });
  const first = await publishFigure({ pageId: "page", userId: "author", sourceId: one.id, relativePath: "plot.svg", file: file("red") });
  const second = await publishFigure({ pageId: "page", userId: "author", sourceId: two.id, relativePath: "plot.svg", file: file("blue") });
  expect(first.id).not.toBe(second.id);
  await expect(publishFigure({ pageId: "page", userId: "author", sourceId: one.id, relativePath: "plot.svg", expectedVersion: 9, file: file("black") })).rejects.toThrow("versionConflict");
  await expect(publishFigure({ pageId: "page", userId: "intruder", sourceId: one.id, relativePath: "plot.svg", expectedVersion: 1, file: file("black") })).rejects.toThrow("forbidden");
});
it("restoring pauses the source and detaching preserves the last valid bytes", async () => {
  const source = createFigureSource("page", "author", { kind: "laptop", name: "Research" });
  const initial = await publishFigure({ pageId: "page", userId: "author", sourceId: source.id, relativePath: "plot.svg", file: file("red") });
  await publishFigure({ pageId: "page", userId: "author", sourceId: source.id, relativePath: "plot.svg", expectedVersion: 1, file: file("blue") });
  const revision = figureManifest("page", "author").assets[0].revisions.find((item) => item.version === 1)!;
  const restored = await changeFigureAsset("page", "author", { action: "restore", assetId: initial.id, expectedVersion: 2, revisionId: revision.id });
  expect(restored.paused).toBe(true);
  const copy = await changeFigureAsset("page", "author", { action: "detach", assetId: initial.id, expectedVersion: restored.version });
  expect(copy.sourceId).toBeNull(); expect(copy.id).not.toBe(initial.id);
  expect(Buffer.from((await figureRevisionBytes("page", copy.id)).bytes).toString()).toContain('fill="red"');
});
it("re-resolves server paths after atomic replacement and retains the image on invalid writes", async () => {
  const source = createFigureSource("page", "author", { kind: "server", name: "Research", rootKey: "research" });
  const target = path.join(sourceFolder, "plot.svg"); fs.writeFileSync(target, svg("red"));
  const first = await syncServerFigure("page", source.id, "plot.svg", "author");
  const temporary = path.join(sourceFolder, "new.svg"); fs.writeFileSync(temporary, svg("green")); fs.renameSync(temporary, target);
  await syncServerFigure("page", source.id, "plot.svg", "author", first.id);
  expect(figureAsset("page", first.id).version).toBe(2);
  fs.writeFileSync(target, "<svg");
  await expect(syncServerFigure("page", source.id, "plot.svg", "author", first.id)).rejects.toThrow();
  expect(figureAsset("page", first.id)).toMatchObject({ version: 2, status: "sourceUnavailable" });
  expect(Buffer.from((await figureRevisionBytes("page", first.id)).bytes).toString()).toContain('fill="green"');
  await expect(resolveFigureServerPath("research", "../private.svg")).rejects.toThrow("invalidPath");
});
it("invalid file content and sidecars do not publish a revision", async () => {
  await expect(publishFigure({ pageId: "page", userId: "author", file: new File(["not a PNG"], "fake.png", { type: "image/png" }) })).rejects.toThrow();
  await expect(publishFigure({ pageId: "page", userId: "author", file: file("red"), sidecar: "{}" })).rejects.toThrow();
  expect(db.select().from(wikiFigureAssets).all()).toHaveLength(0);
});

it("does not let a delayed server read overwrite a newer published image", async () => {
  const source = createFigureSource("page", "author", { kind: "server", name: "Research", rootKey: "research" });
  const target = path.join(sourceFolder, "race.svg"); fs.writeFileSync(target, svg("red"));
  const asset = await syncServerFigure("page", source.id, "race.svg", "author");
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reading = new Promise<void>((resolve) => { ready = resolve; });
  const read = serverPaths.readFigureServerFile;
  let delayed = false;
  const spy = vi.spyOn(serverPaths, "readFigureServerFile").mockImplementation(async (...args) => {
    const result = await read(...args);
    if (args[1] === "race.svg" && !delayed) { delayed = true; ready(); await gate; }
    return result;
  });
  const oldRead = syncServerFigure("page", source.id, "race.svg", "author", asset.id);
  try {
    await reading;
    fs.writeFileSync(target, svg("blue"));
    await syncServerFigure("page", source.id, "race.svg", "author", asset.id);
    release(); await expect(oldRead).rejects.toThrow("versionConflict");
    expect(figureAsset("page", asset.id).version).toBe(2);
    expect(Buffer.from((await figureRevisionBytes("page", asset.id)).bytes).toString()).toContain('fill="blue"');
  } finally { release(); spy.mockRestore(); }
});

it("updates PNG bytes atomically and accepts compressed Python SVG artwork", async () => {
  const sharp = (await import("sharp")).default;
  const source = createFigureSource("page", "author", { kind: "server", name: "Raster", rootKey: "research" });
  const target = path.join(sourceFolder, "raster.png");
  await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).png().toFile(target);
  const asset = await syncServerFigure("page", source.id, "raster.png", "author");
  const temporary = path.join(sourceFolder, "replacement.png");
  await sharp({ create: { width: 20, height: 10, channels: 3, background: "blue" } }).png().toFile(temporary);
  fs.renameSync(temporary, target);
  await syncServerFigure("page", source.id, "raster.png", "author", asset.id);
  expect(figureAsset("page", asset.id).version).toBe(2);
  const { gzipSync } = await import("node:zlib");
  const compressed = new File([gzipSync(svg("green"))], "python.svgz", { type: "image/svg+xml" });
  const vector = await publishFigure({ pageId: "page", userId: "author", file: compressed });
  expect((await figureRevisionBytes("page", vector.id)).mimeType).toBe("image/svg+xml");
});

it("rejects directory links escaping a configured root", async () => {
  const root = path.join(sourceFolder, "confined"); const outside = path.join(sourceFolder, "outside");
  fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "private.svg"), svg("red"));
  fs.symlinkSync(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
  process.env.WIKI_FIGURE_ROOTS = JSON.stringify({ research: root });
  await expect(resolveFigureServerPath("research", "escape/private.svg")).rejects.toThrow("invalidPath");
});

it("freezes every occurrence to the chosen revision when artwork changes during export", async () => {
  const { snapshotDocumentImages } = await import("./lib/document-pdf");
  const { DEFAULT_DOCUMENT_SETTINGS } = await import("./lib/document-settings");
  const { DEFAULT_WIKI_TYPOGRAPHY } = await import("./lib/wiki-typography");
  const source = createFigureSource("page", "author", { kind: "laptop", name: "Plots" });
  const first = await publishFigure({ pageId: "page", userId: "author", sourceId: source.id, relativePath: "plot.svg", file: file("red") });
  const crop = { x: .1, y: 0, width: .8, height: 1 };
  const doc = { type: "doc", content: ["one", "two"].map((nodeId) => ({ type: "commentableImage", attrs: { nodeId, assetId: first.id, caption: "My caption", crop, widthPercent: 45 } })) };
  const snapshot = snapshotDocumentImages("page", doc, DEFAULT_WIKI_TYPOGRAPHY, DEFAULT_DOCUMENT_SETTINGS, { [first.id]: 1 });
  await publishFigure({ pageId: "page", userId: "author", sourceId: source.id, relativePath: "plot.svg", expectedVersion: 1, file: file("blue") });
  const result = await snapshot;
  expect(result.images.size).toBe(2);
  for (const image of result.images.values()) expect(Buffer.from(image.bytes).toString()).toContain('fill="red"');
  expect(result.doc.content?.[0].attrs).toMatchObject({ caption: "My caption", crop, widthPercent: 45 });
  expect(doc.content[0].attrs).not.toHaveProperty("src");
});
