import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import sharp from "sharp";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attachments, user, wikiPages, wikiSvgAssets, wikiFigureAssets, wikiFigureSources, wikiFigureRevisions, wikiPageSources } from "@/db/schema";
import { saveAttachment, deleteAttachment, getAttachmentAbsolutePath, MAX_UPLOAD_BYTES } from "@/lib/files";
import { isSafeInlineSvg } from "@/lib/svg-upload";
import { figureMime, relativeFigurePath, stripFigureNumber } from "./lib/figure";
import { figureServerRoots, readFigureServerFile, resolveFigureServerPath } from "./lib/figure-server-path";
import { graphicsSidecarSchema } from "./lib/source-input";
import { saveSourceRecord } from "./source-records";
import { listSvgAssets, renderSvgAsset } from "./svg-assets";
import type { FigureManifest } from "./lib/figure-types";
import { normalizeFigureSvg } from "./lib/figure-svg";

const hash = (bytes: Uint8Array | string) => crypto.createHash("sha256").update(bytes).digest("hex");
export function requireFigurePage(pageId: string) {
  const page = db.select().from(wikiPages).where(and(eq(wikiPages.id, pageId), isNull(wikiPages.deletedAt))).get();
  if (!page) throw new Error("notFound");
  return page;
}
export const figureSourceInput = z.object({ kind: z.enum(["laptop", "server"]), name: z.string().trim().min(1).max(120), rootKey: z.string().max(60).default("") });
export function createFigureSource(pageId: string, userId: string, input: unknown) {
  requireFigurePage(pageId);
  const data = figureSourceInput.parse(input);
  if (data.kind === "server" && !figureServerRoots()[data.rootKey]) throw new Error("sourceUnavailable");
  return db.insert(wikiFigureSources).values({ ...data, pageId, createdBy: userId }).returning().get();
}
function sourceFor(pageId: string, sourceId: string) {
  const source = db.select().from(wikiFigureSources).where(and(eq(wikiFigureSources.id, sourceId), eq(wikiFigureSources.pageId, pageId))).get();
  if (!source) throw new Error("notFound");
  return source;
}
export function figureAsset(pageId: string, assetId: string) {
  const asset = db.select().from(wikiFigureAssets).where(and(eq(wikiFigureAssets.id, assetId), eq(wikiFigureAssets.pageId, pageId))).get();
  if (!asset) throw new Error("notFound");
  return asset;
}

export async function validateFigureFile(file: File) {
  const mime = figureMime(file.name) || file.type;
  if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(mime) || !file.size || file.size > MAX_UPLOAD_BYTES) throw new Error("invalidFile");
  let bytes = Buffer.from(await file.arrayBuffer());
  if (mime === "image/svg+xml") {
    if (/\.svgz$/i.test(file.name) || (bytes[0] === 0x1f && bytes[1] === 0x8b)) bytes = gunzipSync(bytes, { maxOutputLength: 10 * 1024 * 1024 });
    bytes = Buffer.from(normalizeFigureSvg(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (!isSafeInlineSvg(bytes)) throw new Error("invalidFile");
  }
  const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  const expected = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp", "image/svg+xml": "svg" }[mime];
  if (metadata.format !== expected || !metadata.width || !metadata.height) throw new Error("invalidFile");
  // Decode raster pixels as well: a valid header alone does not establish a complete file.
  if (mime !== "image/svg+xml") await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" }).stats();
  return new File([new Uint8Array(bytes)], file.name.replace(/\.svgz$/i, ".svg"), { type: mime });
}

function applyFigureSidecar(assetId: string, pageId: string, userId: string, raw?: string) {
  if (raw === undefined) return;
  const asset = figureAsset(pageId, assetId);
  const sidecarHash = hash(raw);
  if (asset.sidecarHash === sidecarHash && asset.literatureSourceId) return;
  const { caption, ...source } = graphicsSidecarSchema.parse(JSON.parse(raw));
  const result = saveSourceRecord({ ...source, ...(asset.literatureSourceId ? { id: asset.literatureSourceId } : {}) }, userId);
  if (!result.ok) throw new Error("sidecarConflict");
  db.insert(wikiPageSources).values({ pageId, sourceId: result.id, relation: "supporting" }).onConflictDoNothing().run();
  db.update(wikiFigureAssets).set({ caption: stripFigureNumber(caption), literatureSourceId: result.id, sidecarHash }).where(eq(wikiFigureAssets.id, assetId)).run();
}

export async function publishFigure(input: { pageId: string; userId: string; file: File; sourceId?: string; relativePath?: string; assetId?: string; expectedVersion?: number; sidecar?: string }) {
  requireFigurePage(input.pageId);
  const source = input.sourceId ? sourceFor(input.pageId, input.sourceId) : null;
  if (source?.kind === "laptop" && source.createdBy !== input.userId) throw new Error("forbidden");
  const relativePath = source ? relativeFigurePath(input.relativePath || "") : "";
  const previous = input.assetId ? figureAsset(input.pageId, input.assetId) : source ? db.select().from(wikiFigureAssets).where(and(eq(wikiFigureAssets.sourceId, source.id), eq(wikiFigureAssets.relativePath, relativePath))).get() : undefined;
  if (previous && previous.sourceId !== (source?.id ?? null)) throw new Error("sourceConflict");
  if (previous && source && previous.relativePath !== relativePath) throw new Error("sourceConflict");
  if (previous?.paused) return previous;
  if (previous && input.expectedVersion !== previous.version) throw new Error("versionConflict");
  if (input.sidecar !== undefined) {
    if (input.sidecar.length > 100_000) throw new Error("invalidSidecar");
    graphicsSidecarSchema.parse(JSON.parse(input.sidecar));
  }
  const file = await validateFigureFile(input.file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const old = previous ? db.select().from(attachments).where(eq(attachments.id, previous.attachmentId)).get() : null;
  if (previous && old?.sha256 === hash(bytes)) {
    return db.transaction(() => {
      const current = figureAsset(input.pageId, previous.id);
      if (current.version !== previous.version || current.paused) throw new Error("versionConflict");
      applyFigureSidecar(previous.id, input.pageId, input.userId, input.sidecar);
      if (previous.status !== "ready" || !previous.lastCheckedAt || Date.now() - previous.lastCheckedAt.getTime() > 60_000) db.update(wikiFigureAssets).set({ status: "ready", lastCheckedAt: new Date() }).where(eq(wikiFigureAssets.id, previous.id)).run();
      return figureAsset(input.pageId, previous.id);
    });
  }
  const attachment = await saveAttachment({ file, entityType: "wikiPage", entityId: input.pageId, userId: input.userId });
  try {
    return db.transaction(() => {
      const now = new Date();
      const version = (previous?.version ?? 0) + 1;
      let assetId = previous?.id;
      if (previous) {
        const changed = db.update(wikiFigureAssets).set({ attachmentId: attachment.id, version, status: "ready", lastCheckedAt: now, updatedAt: now }).where(and(eq(wikiFigureAssets.id, previous.id), eq(wikiFigureAssets.version, previous.version), eq(wikiFigureAssets.paused, false))).run();
        if (!changed.changes) throw new Error("versionConflict");
      } else {
        assetId = db.insert(wikiFigureAssets).values({ pageId: input.pageId, sourceId: source?.id, relativePath, attachmentId: attachment.id, lastCheckedAt: now }).returning({ id: wikiFigureAssets.id }).get().id;
      }
      db.insert(wikiFigureRevisions).values({ assetId: assetId!, attachmentId: attachment.id, version, createdBy: input.userId }).run();
      applyFigureSidecar(assetId!, input.pageId, input.userId, input.sidecar);
      return figureAsset(input.pageId, assetId!);
    });
  } catch (error) { deleteAttachment(attachment.id); throw error; }
}

export function figureManifest(pageId: string, userId: string): FigureManifest {
  requireFigurePage(pageId);
  const assets = db.select({ asset: wikiFigureAssets, file: attachments }).from(wikiFigureAssets).innerJoin(attachments, eq(wikiFigureAssets.attachmentId, attachments.id)).where(eq(wikiFigureAssets.pageId, pageId)).all();
  return {
    assets: assets.map(({ asset, file }) => ({ ...asset, fileName: file.fileName, mimeType: file.mimeType,
      src: `/api/wiki/figures/${asset.id}/content?v=${asset.version}`,
      updatedAt: asset.updatedAt.toISOString(), lastCheckedAt: asset.lastCheckedAt?.toISOString() ?? null,
      revisions: db.select().from(wikiFigureRevisions).where(eq(wikiFigureRevisions.assetId, asset.id)).orderBy(desc(wikiFigureRevisions.version)).all().map((revision) => ({ id: revision.id, version: revision.version, createdAt: revision.createdAt.toISOString() })),
    })),
    sources: db.select().from(wikiFigureSources).where(eq(wikiFigureSources.pageId, pageId)).all().map((source) => ({ id: source.id, kind: source.kind, name: source.name, rootKey: source.rootKey, owned: source.createdBy === userId })),
    roots: Object.keys(figureServerRoots()),
  };
}

export async function syncServerFigure(pageId: string, sourceId: string, inputPath: string, userId: string, assetId?: string) {
  requireFigurePage(pageId);
  const source = sourceFor(pageId, sourceId);
  if (source.kind !== "server") throw new Error("forbidden");
  try {
    // Pin the version before reading: another sync may publish while this read is in flight.
    const resolved = await resolveFigureServerPath(source.rootKey, inputPath);
    const previous = assetId ? figureAsset(pageId, assetId) : db.select().from(wikiFigureAssets).where(and(eq(wikiFigureAssets.sourceId, sourceId), eq(wikiFigureAssets.relativePath, resolved.relativePath))).get();
    const { bytes, relativePath } = await readFigureServerFile(source.rootKey, inputPath, MAX_UPLOAD_BYTES);
    let sidecar: string | undefined;
    try { sidecar = (await readFigureServerFile(source.rootKey, relativePath.replace(/\.[^/.]+$/, ".json"), 100_000)).bytes.toString("utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return await publishFigure({ pageId, userId, sourceId, relativePath, assetId: previous?.id, expectedVersion: previous?.version, file: new File([new Uint8Array(bytes)], relativePath.split("/").pop()!, { type: figureMime(relativePath) }), sidecar });
  } catch (error) {
    if (assetId && (error as Error).message !== "versionConflict") db.update(wikiFigureAssets).set({ status: "sourceUnavailable" }).where(and(eq(wikiFigureAssets.id, assetId), eq(wikiFigureAssets.pageId, pageId))).run();
    throw error;
  }
}

export async function refreshServerFigures(pageId?: string) {
  const sources = db.select().from(wikiFigureSources).where(eq(wikiFigureSources.kind, "server")).all().filter((source) => !pageId || source.pageId === pageId);
  for (const source of sources) {
    const author = db.select().from(user).where(eq(user.id, source.createdBy)).get();
    if (!author || author.banned) continue;
    const assets = db.select().from(wikiFigureAssets).where(and(eq(wikiFigureAssets.sourceId, source.id), eq(wikiFigureAssets.paused, false))).all();
    for (const asset of assets) await syncServerFigure(source.pageId, source.id, asset.relativePath, source.createdBy, asset.id).catch(() => undefined);
  }
}

export async function changeFigureAsset(pageId: string, userId: string, raw: unknown) {
  const data = z.object({ assetId: z.string(), expectedVersion: z.number().int().positive(), action: z.enum(["pause", "resume", "restore", "detach", "relink"]), revisionId: z.string().optional(), sourceId: z.string().optional(), path: z.string().optional() }).parse(raw);
  requireFigurePage(pageId);
  const asset = figureAsset(pageId, data.assetId);
  if (asset.version !== data.expectedVersion) throw new Error("versionConflict");
  if (data.action === "detach") {
    const created = db.transaction(() => {
      const copy = db.insert(wikiFigureAssets).values({ pageId, attachmentId: asset.attachmentId, caption: asset.caption, literatureSourceId: asset.literatureSourceId }).returning().get();
      db.insert(wikiFigureRevisions).values({ assetId: copy.id, version: 1, attachmentId: copy.attachmentId, createdBy: userId }).run();
      return copy;
    });
    return created;
  }
  let attachmentId = asset.attachmentId;
  if (data.action === "restore") {
    const revision = db.select().from(wikiFigureRevisions).where(and(eq(wikiFigureRevisions.id, data.revisionId || ""), eq(wikiFigureRevisions.assetId, asset.id))).get();
    if (!revision) throw new Error("notFound");
    attachmentId = revision.attachmentId;
  }
  let sourceId = asset.sourceId, relativePath = asset.relativePath;
  if (data.action === "relink") {
    const source = sourceFor(pageId, data.sourceId || "");
    if (source.kind === "laptop" && source.createdBy !== userId) throw new Error("forbidden");
    sourceId = source.id;
    relativePath = source.kind === "server" ? (await resolveFigureServerPath(source.rootKey, data.path || "")).relativePath : relativeFigurePath(data.path || "");
  }
  return db.transaction(() => {
    const next = db.update(wikiFigureAssets).set({ sourceId, relativePath, attachmentId, paused: data.action === "pause" || data.action === "restore", version: asset.version + 1, status: data.action === "relink" ? "sourceUnavailable" : asset.status, updatedAt: new Date() }).where(and(eq(wikiFigureAssets.id, asset.id), eq(wikiFigureAssets.version, asset.version))).returning().get();
    if (!next) throw new Error("versionConflict");
    db.insert(wikiFigureRevisions).values({ assetId: asset.id, version: next.version, attachmentId, createdBy: userId }).run();
    return next;
  });
}

/** Read an immutable revision once per export; the returned bytes cannot change mid-render. */
export async function figureRevisionBytes(pageId: string, assetId: string, version?: number) {
  const asset = figureAsset(pageId, assetId);
  const revision = db.select().from(wikiFigureRevisions).where(and(eq(wikiFigureRevisions.assetId, assetId), eq(wikiFigureRevisions.version, version ?? asset.version))).get();
  if (!revision) throw new Error("notFound");
  const attachment = db.select().from(attachments).where(eq(attachments.id, revision.attachmentId)).get();
  if (!attachment || attachment.entityId !== pageId) throw new Error("notFound");
  const bytes = await fs.readFile(getAttachmentAbsolutePath(attachment.storedName));
  return { bytes, mimeType: attachment.mimeType, fileName: attachment.fileName };
}

/** Existing SVG uploads keep their typography renderer when adopted into the figure picker. */
export async function adoptFigureAttachment(pageId: string, userId: string, attachmentId: string) {
  requireFigurePage(pageId);
  const file = db.select().from(attachments).where(and(eq(attachments.id, attachmentId), eq(attachments.entityType, "wikiPage"), eq(attachments.entityId, pageId))).get();
  if (!file) throw new Error("notFound");
  let bytes = await fs.readFile(getAttachmentAbsolutePath(file.storedName));
  if (file.mimeType === "image/svg+xml") {
    listSvgAssets(pageId, userId);
    const svg = db.select().from(wikiSvgAssets).where(eq(wikiSvgAssets.attachmentId, file.id)).get();
    const rendered = svg ? renderSvgAsset(svg.id) : null;
    if (rendered) bytes = Buffer.from(rendered.svg);
  }
  return publishFigure({ pageId, userId, file: new File([new Uint8Array(bytes)], file.fileName.replace(/\.svgz$/i, ".svg"), { type: file.mimeType }) });
}

/** Editing starts with independent attachment bytes; the live source and its history stay intact. */
export async function editableFigureCopy(pageId: string, userId: string, assetId: string, version: number) {
  requireFigurePage(pageId);
  const asset = figureAsset(pageId, assetId);
  if (asset.version !== version) throw new Error("versionConflict");
  const image = await figureRevisionBytes(pageId, assetId, version);
  if (image.mimeType !== "image/svg+xml") throw new Error("invalidFile");
  const file = await saveAttachment({ file: new File([new Uint8Array(image.bytes)], image.fileName.replace(/\.svg$/i, "-edit.svg"), { type: image.mimeType }), entityType: "wikiPage", entityId: pageId, userId });
  const editable = listSvgAssets(pageId, userId).find((item) => item.attachmentId === file.id);
  if (!editable) { deleteAttachment(file.id); throw new Error("invalidFile"); }
  db.update(wikiSvgAssets).set({ caption: asset.caption, sourceId: asset.literatureSourceId }).where(eq(wikiSvgAssets.id, editable.id)).run();
  return { ...editable, fileName: file.fileName, mimeType: image.mimeType };
}

const workerGlobal = globalThis as typeof globalThis & { figureWorker?: ReturnType<typeof setTimeout>; figureWorkerBusy?: boolean };
export function startFigureSyncWorker() {
  if (workerGlobal.figureWorker || process.env.NEXT_PHASE === "phase-production-build") return;
  const tick = async () => {
    if (!workerGlobal.figureWorkerBusy) {
      workerGlobal.figureWorkerBusy = true;
      try { await refreshServerFigures(); } catch { /* A later tick retries transient database failures. */ }
      finally { workerGlobal.figureWorkerBusy = false; }
    }
    workerGlobal.figureWorker = setTimeout(() => void tick(), 5000);
    workerGlobal.figureWorker.unref();
  };
  workerGlobal.figureWorker = setTimeout(() => void tick(), 5000);
  workerGlobal.figureWorker.unref();
}
