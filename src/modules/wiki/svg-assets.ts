import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  attachments,
  wikiPages,
  wikiSources,
  wikiSvgAssets,
  wikiFigureRevisions,
  wikiSvgRevisions,
} from "@/db/schema";
import { linkSupportingSource, saveSource } from "./research-actions";
import { graphicsSidecarSchema } from "./lib/source-input";
import { deleteAttachment, getAttachmentAbsolutePath, saveAttachment } from "@/lib/files";
import { isSafeInlineSvg } from "@/lib/svg-upload";
import { parseDocumentSettings } from "./lib/document-settings";
import { applyDocumentTypography, type SvgDocument, type SvgElement } from "./lib/svg-typography";
import { getWikiTypographyForUser } from "./lib/wiki-typography.server";
import { extractSvgTextLayers, isEditableSvgText, ownSvgText, parseSvgBindings, setOwnSvgText, writeSvgNumber, type SvgTextLayer } from "./lib/svg-text";
export type { SvgTextLayer } from "./lib/svg-text";

export type SvgAssetDto = {
  id: string;
  attachmentId: string;
  fileName: string;
  version: number;
  layers: SvgTextLayer[];
  contentUrl: string;
  sourcePath: string | null;
  sizeScale: number | null;
  caption: string | null;
  sourceTitle: string | null;
  revisions: Array<{ id: string; version: number; createdAt: string }>;
};

// Caps gunzip's output so a small, highly-compressed .svgz cannot force an unbounded allocation (decompression bomb).
const MAX_SVG_DECOMPRESSED_BYTES = 10 * 1024 * 1024; // 10 MB

function decodeSvg(buffer: Buffer, fileName: string) {
  const bytes = fileName.toLocaleLowerCase().endsWith(".svgz") || (buffer[0] === 0x1f && buffer[1] === 0x8b)
    ? gunzipSync(buffer, { maxOutputLength: MAX_SVG_DECOMPRESSED_BYTES })
    : buffer;
  if (!isSafeInlineSvg(bytes)) throw new Error("Unsafe SVG");
  return bytes.toString("utf8");
}

// The page version also bumps on every document-settings save (see savePageContent), so folding
// it into the cache-busting query param forces open <img> tags to reload when typography settings
// change, even though the asset's own version did not.
function svgContentUrl(assetId: string, assetVersion: number, pageVersion: number) {
  return `/api/wiki/svg-assets/${assetId}/content?v=${assetVersion}.${pageVersion}`;
}

function annotateSvg(svg: string) {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const all = [
    ...Array.from(document.getElementsByTagName("text")),
    ...Array.from(document.getElementsByTagName("tspan")),
  ];
  const label = (elements: typeof all, prefix: string) => elements.forEach((element, index) => {
    if (!element.getAttribute("data-wiki-text-id")) {
      element.setAttribute("data-wiki-text-id", `${prefix}-${index + 1}`);
    }
  });
  label(all.filter((element) => element.getElementsByTagName("tspan").length === 0), "svg-text");
  // A <text> that wraps a tspan still owns the text in front of it. Numbered in a
  // series of its own so the ids above keep their numbers, and with them the
  // bindings of graphics that were imported before this existed.
  label(all.filter((element) => element.getElementsByTagName("tspan").length > 0 && ownSvgText(element).trim()), "svg-label");
  return new XMLSerializer().serializeToString(document);
}

/**
 * Gives a graphic imported before mixed-content labels existed its `svg-label-*`
 * ids, so the headline number in "4.025 €/Monat" becomes editable without waiting
 * for the artwork to change. Only ever adds attributes, so the drawing and the
 * version stay as they are.
 */
function backfillOwnTextLabels(assetId: string, currentSvg: string) {
  if (currentSvg.includes(`data-wiki-text-id="svg-label-`)) return currentSvg;
  let annotated: string;
  try {
    annotated = annotateSvg(currentSvg);
  } catch {
    return currentSvg;
  }
  // Guarded on the new ids rather than on inequality, so a serializer quirk can
  // never turn every read into a write.
  if (!annotated.includes(`data-wiki-text-id="svg-label-`)) return currentSvg;
  db.update(wikiSvgAssets).set({ currentSvg: annotated }).where(eq(wikiSvgAssets.id, assetId)).run();
  return annotated;
}

export function listSvgAssets(pageId: string, userId: string): SvgAssetDto[] {
  const page = db.select({ version: wikiPages.version }).from(wikiPages).where(eq(wikiPages.id, pageId)).get();
  const pageVersion = page?.version ?? 0;
  const immutableFiles = new Set(db.select({ id: wikiFigureRevisions.attachmentId }).from(wikiFigureRevisions).all().map((row) => row.id));
  const files = db.select().from(attachments)
    .where(and(eq(attachments.entityType, "wikiPage"), eq(attachments.entityId, pageId)))
    .all()
    .filter((file) => !immutableFiles.has(file.id) && (file.mimeType === "image/svg+xml" || /\.svgz?$/i.test(file.fileName)));
  for (const file of files) {
    const existing = db.select().from(wikiSvgAssets).where(eq(wikiSvgAssets.attachmentId, file.id)).get();
    if (existing) continue;
    try {
      const original = fs.readFileSync(getAttachmentAbsolutePath(file.storedName));
      const currentSvg = annotateSvg(decodeSvg(original, file.fileName));
      db.insert(wikiSvgAssets).values({
        pageId,
        attachmentId: file.id,
        currentSvg,
        updatedBy: userId,
      }).run();
    } catch {
      // A file that only looks like an SVG — wrong content type, corrupt, or gone
      // from disk — is skipped. Failing here would take every other graphic on the
      // page down with it.
      continue;
    }
  }
  return db.select({
    id: wikiSvgAssets.id,
    attachmentId: wikiSvgAssets.attachmentId,
    fileName: attachments.fileName,
    version: wikiSvgAssets.version,
    currentSvg: wikiSvgAssets.currentSvg,
    bindingsJson: wikiSvgAssets.bindingsJson,
    sourcePath: wikiSvgAssets.sourcePath,
    sizeScale: wikiSvgAssets.sizeScale,
    caption: wikiSvgAssets.caption,
    sourceTitle: wikiSources.title,
  })
    .from(wikiSvgAssets)
    .innerJoin(attachments, eq(wikiSvgAssets.attachmentId, attachments.id))
    // The deleted check belongs in the join, not the where: a graphic whose
    // Literaturstelle sits in the trash still lists, just without the badge.
    .leftJoin(wikiSources, and(eq(wikiSvgAssets.sourceId, wikiSources.id), isNull(wikiSources.deletedAt)))
    .where(eq(wikiSvgAssets.pageId, pageId))
    // A numbered set (01_… to 07_…) has to stay in its own order; without this the
    // rows come back in storage order and re-shuffle on every edit.
    .orderBy(asc(attachments.fileName))
    .all()
    .map((asset) => {
      const currentSvg = backfillOwnTextLabels(asset.id, asset.currentSvg);
      const revisions = db.select({
        id: wikiSvgRevisions.id,
        version: wikiSvgRevisions.version,
        createdAt: wikiSvgRevisions.createdAt,
      }).from(wikiSvgRevisions)
        .where(eq(wikiSvgRevisions.assetId, asset.id))
        .orderBy(desc(wikiSvgRevisions.version))
        .limit(20)
        .all()
        .map((revision) => ({ ...revision, createdAt: revision.createdAt.toISOString() }));
      return {
        id: asset.id,
        attachmentId: asset.attachmentId,
        fileName: asset.fileName,
        version: asset.version,
        layers: extractSvgTextLayers(currentSvg, asset.bindingsJson),
        contentUrl: svgContentUrl(asset.id, asset.version, pageVersion),
        sourcePath: asset.sourcePath,
        sizeScale: asset.sizeScale,
        caption: asset.caption,
        sourceTitle: asset.sourceTitle,
        revisions,
      };
    });
}

/**
 * Attachments the graphics panel owns. The attachment list leaves these out so a
 * synced diagram is not listed twice in the same sidebar.
 */
export function listGraphicAttachmentIds(pageId: string) {
  return new Set([
    ...db.select({ attachmentId: wikiSvgAssets.attachmentId }).from(wikiSvgAssets).where(eq(wikiSvgAssets.pageId, pageId)).all(),
    ...db.select({ attachmentId: wikiFigureRevisions.attachmentId }).from(wikiFigureRevisions).innerJoin(attachments, eq(attachments.id, wikiFigureRevisions.attachmentId)).where(eq(attachments.entityId, pageId)).all(),
  ].map((row) => row.attachmentId));
}

export type SvgFolderSyncResult = {
  added: number;
  updated: number;
  unchanged: number;
  sources: number;
  failed: Array<{ path: string; reason: string }>;
};

/** `folder/01_x.svg` and `folder/01_x.json` pair on everything before the extension. */
function sidecarKey(filePath: string) {
  return filePath.replace(/\.[^./]+$/, "");
}

/**
 * The record a sidecar should revise. Trashed entries never qualify — reviving one
 * in place would leave the edit invisible in the Quellenliste — so a deleted
 * Literaturstelle really does start over.
 */
function sidecarTarget(assetId: string, ownSourceId: string | null, title: string) {
  if (ownSourceId) {
    const own = db.select({ id: wikiSources.id }).from(wikiSources)
      .where(and(eq(wikiSources.id, ownSourceId), isNull(wikiSources.deletedAt)))
      .get();
    // The caller already ruled out an unchanged sidecar, so this one always saves.
    if (own) return { id: own.id, sidecarSha256: null as string | null };
  }
  // The same folder synced into a second page shares one Literaturstelle instead of
  // filling the library with byte-identical copies. Only entries another graphic
  // imported are candidates, so hand-written sources are never touched.
  return db.select({ id: wikiSources.id, sidecarSha256: wikiSvgAssets.sidecarSha256 })
    .from(wikiSvgAssets)
    .innerJoin(wikiSources, eq(wikiSvgAssets.sourceId, wikiSources.id))
    .where(and(ne(wikiSvgAssets.id, assetId), eq(wikiSources.title, title), isNull(wikiSources.deletedAt)))
    .get();
}

/**
 * Imports the Literaturstelle that sits beside a graphic. The source record is
 * reused across syncs and across pages, so editing the sidecar revises the
 * existing entry rather than piling up duplicates.
 */
async function applySidecar(input: { assetId: string; pageId: string; file: File }) {
  const raw = await input.file.text();
  const sidecarSha256 = crypto.createHash("sha256").update(raw).digest("hex");
  const asset = db.select({ sourceId: wikiSvgAssets.sourceId, sidecarSha256: wikiSvgAssets.sidecarSha256 })
    .from(wikiSvgAssets).where(eq(wikiSvgAssets.id, input.assetId)).get();
  if (!asset || asset.sidecarSha256 === sidecarSha256) return false;
  const { caption, ...source } = graphicsSidecarSchema.parse(JSON.parse(raw));
  const target = sidecarTarget(input.assetId, asset.sourceId, source.title);
  // An entry another graphic already imported from these exact bytes is current;
  // adopting it must not write a source revision that changes nothing.
  const sourceId = target?.sidecarSha256 === sidecarSha256 ? target.id : await (async () => {
    const result = await saveSource({ ...source, ...(target ? { id: target.id } : {}) });
    if (!result.ok) throw new Error(`Duplicate of source "${result.duplicate.title}"`);
    return result.id;
  })();
  await linkSupportingSource(input.pageId, sourceId);
  db.update(wikiSvgAssets)
    .set({ sourceId, caption, sidecarSha256 })
    .where(eq(wikiSvgAssets.id, input.assetId))
    .run();
  return true;
}

/**
 * Re-imports a picked source folder. Files are matched by their folder-relative
 * path, so a changed file becomes a new version of the *same* asset and
 * attachment — documents keep pointing at it and simply render the new version.
 */
export async function syncSvgAssetsFromFolder(input: {
  pageId: string;
  userId: string;
  files: Array<{ path: string; file: File }>;
}): Promise<SvgFolderSyncResult> {
  const result: SvgFolderSyncResult = { added: 0, updated: 0, unchanged: 0, sources: 0, failed: [] };
  const sidecars = new Map<string, File>();
  const graphics: typeof input.files = [];
  for (const entry of input.files) {
    if (/\.json$/i.test(entry.path)) sidecars.set(sidecarKey(entry.path), entry.file);
    else graphics.push(entry);
  }
  for (const { path: sourcePath, file } of graphics) {
    let assetId = "";
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const sourceSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      const columns = {
        id: wikiSvgAssets.id,
        attachmentId: wikiSvgAssets.attachmentId,
        currentSvg: wikiSvgAssets.currentSvg,
        bindingsJson: wikiSvgAssets.bindingsJson,
        version: wikiSvgAssets.version,
        sourceSha256: wikiSvgAssets.sourceSha256,
      };
      const existing = db.select(columns).from(wikiSvgAssets)
        .where(and(eq(wikiSvgAssets.pageId, input.pageId), eq(wikiSvgAssets.sourcePath, sourcePath)))
        .get()
        // Adopt an asset that was uploaded by hand before folder sync existed, so
        // the first sync starts tracking it instead of creating a duplicate.
        ?? db.select(columns).from(wikiSvgAssets)
          .innerJoin(attachments, eq(wikiSvgAssets.attachmentId, attachments.id))
          .where(and(
            eq(wikiSvgAssets.pageId, input.pageId),
            isNull(wikiSvgAssets.sourcePath),
            eq(attachments.fileName, file.name),
          ))
          .get();

      if (existing?.sourceSha256 === sourceSha256) {
        // Untouched artwork still gets its sidecar checked — the Literaturstelle
        // can change on its own.
        result.unchanged += 1;
        assetId = existing.id;
      } else if (!existing) {
        const nextSvg = annotateSvg(decodeSvg(buffer, file.name));
        const attachment = await saveAttachment({
          file,
          entityType: "wikiPage",
          entityId: input.pageId,
          userId: input.userId,
        });
        try {
          assetId = db.insert(wikiSvgAssets).values({
            pageId: input.pageId,
            attachmentId: attachment.id,
            currentSvg: nextSvg,
            sourcePath,
            sourceSha256,
            updatedBy: input.userId,
          }).returning({ id: wikiSvgAssets.id }).get().id;
        } catch (reason) {
          // A concurrent sync already claimed this sourcePath: the attachment we just
          // wrote is now orphaned (no wikiSvgAssets row references it), so remove it.
          deleteAttachment(attachment.id);
          throw reason;
        }
        result.added += 1;
      } else {
        const nextSvg = annotateSvg(decodeSvg(buffer, file.name));
        const attachment = db.select().from(attachments).where(eq(attachments.id, existing.attachmentId)).get();
        db.transaction(() => {
          db.insert(wikiSvgRevisions).values({
            assetId: existing.id,
            version: existing.version,
            svg: existing.currentSvg,
            bindingsJson: existing.bindingsJson,
            createdBy: input.userId,
          }).onConflictDoNothing().run();
          // Bindings survive by design: they are keyed by data-wiki-text-id, not by content.
          db.update(wikiSvgAssets).set({
            currentSvg: nextSvg,
            version: existing.version + 1,
            sourcePath,
            sourceSha256,
            updatedBy: input.userId,
            updatedAt: new Date(),
          }).where(and(eq(wikiSvgAssets.id, existing.id), eq(wikiSvgAssets.version, existing.version))).run();
          if (attachment) {
            db.update(attachments)
              .set({ sha256: sourceSha256, sizeBytes: buffer.length })
              .where(eq(attachments.id, attachment.id))
              .run();
          }
        });
        // After the commit, so a failed transaction never leaves a rewritten file behind.
        if (attachment) fs.writeFileSync(getAttachmentAbsolutePath(attachment.storedName), buffer);
        assetId = existing.id;
        result.updated += 1;
      }

      const sidecar = sidecars.get(sidecarKey(sourcePath));
      if (sidecar && await applySidecar({ assetId, pageId: input.pageId, file: sidecar })) {
        result.sources += 1;
      }
    } catch (reason) {
      result.failed.push({ path: sourcePath, reason: reason instanceof Error ? reason.message : "Import failed" });
    }
  }
  return result;
}

export function updateSvgAsset(input: {
  pageId: string;
  assetId: string;
  expectedVersion: number;
  layers: SvgTextLayer[];
  sizeScale?: number | null;
  userId: string;
}) {
  const asset = db.select().from(wikiSvgAssets)
    .where(and(eq(wikiSvgAssets.id, input.assetId), eq(wikiSvgAssets.pageId, input.pageId)))
    .get();
  if (!asset) throw new Error("SVG asset not found");
  if (asset.version !== input.expectedVersion) {
    return { saved: false as const, conflict: true as const, version: asset.version };
  }
  const document = new DOMParser().parseFromString(asset.currentSvg, "image/svg+xml");
  const bindings: Record<string, string> = {};
  for (const layer of input.layers) {
    const elements = [
      ...Array.from(document.getElementsByTagName("text")),
      ...Array.from(document.getElementsByTagName("tspan")),
    ];
    const element = elements.find((candidate) => candidate.getAttribute("data-wiki-text-id") === layer.id);
    if (!element || !isEditableSvgText(element)) continue;
    setOwnSvgText(element, layer.text.slice(0, 10_000));
    writeSvgNumber(element, "font-size", layer.fontSize);
    writeSvgNumber(element, "x", layer.x);
    writeSvgNumber(element, "y", layer.y);
    if (layer.binding) bindings[layer.id] = layer.binding.slice(0, 50);
  }
  const nextSvg = new XMLSerializer().serializeToString(document);
  if (!isSafeInlineSvg(new TextEncoder().encode(nextSvg))) throw new Error("Unsafe SVG result");
  const nextBindingsJson = JSON.stringify(bindings);
  const nextScale = input.sizeScale ?? null;
  const page = db.select({ version: wikiPages.version }).from(wikiPages).where(eq(wikiPages.id, input.pageId)).get();
  // Saving without having changed anything must not spend a version or a history
  // entry — the list is ordered by name, but the history should stay meaningful.
  if (nextSvg === asset.currentSvg && nextBindingsJson === asset.bindingsJson && nextScale === asset.sizeScale) {
    return {
      saved: true as const,
      version: asset.version,
      layers: extractSvgTextLayers(asset.currentSvg, asset.bindingsJson),
      contentUrl: svgContentUrl(asset.id, asset.version, page?.version ?? 0),
    };
  }
  const nextVersion = asset.version + 1;
  db.transaction(() => {
    db.insert(wikiSvgRevisions).values({
      assetId: asset.id,
      version: asset.version,
      svg: asset.currentSvg,
      bindingsJson: asset.bindingsJson,
      createdBy: input.userId,
    }).onConflictDoNothing().run();
    db.update(wikiSvgAssets).set({
      currentSvg: nextSvg,
      bindingsJson: nextBindingsJson,
      version: nextVersion,
      // The version bump also re-points contentUrl, so a changed scale is never served from cache.
      sizeScale: nextScale,
      updatedBy: input.userId,
      updatedAt: new Date(),
    }).where(and(eq(wikiSvgAssets.id, asset.id), eq(wikiSvgAssets.version, asset.version))).run();
  });
  return {
    saved: true as const,
    version: nextVersion,
    layers: extractSvgTextLayers(nextSvg, JSON.stringify(bindings)),
    contentUrl: svgContentUrl(asset.id, nextVersion, page?.version ?? 0),
  };
}

export function restoreSvgAsset(input: {
  pageId: string;
  assetId: string;
  revisionId: string;
  expectedVersion: number;
  userId: string;
}) {
  const asset = db.select().from(wikiSvgAssets)
    .where(and(eq(wikiSvgAssets.id, input.assetId), eq(wikiSvgAssets.pageId, input.pageId)))
    .get();
  if (!asset) throw new Error("SVG asset not found");
  if (asset.version !== input.expectedVersion) {
    return { saved: false as const, conflict: true as const, version: asset.version };
  }
  const revision = db.select().from(wikiSvgRevisions)
    .where(and(eq(wikiSvgRevisions.id, input.revisionId), eq(wikiSvgRevisions.assetId, asset.id)))
    .get();
  if (!revision) throw new Error("SVG revision not found");
  if (!isSafeInlineSvg(new TextEncoder().encode(revision.svg))) throw new Error("Unsafe SVG revision");
  const nextVersion = asset.version + 1;
  db.transaction(() => {
    db.insert(wikiSvgRevisions).values({
      assetId: asset.id,
      version: asset.version,
      svg: asset.currentSvg,
      bindingsJson: asset.bindingsJson,
      createdBy: input.userId,
    }).onConflictDoNothing().run();
    db.update(wikiSvgAssets).set({
      currentSvg: revision.svg,
      bindingsJson: revision.bindingsJson,
      version: nextVersion,
      updatedBy: input.userId,
      updatedAt: new Date(),
    }).where(and(eq(wikiSvgAssets.id, asset.id), eq(wikiSvgAssets.version, asset.version))).run();
  });
  const page = db.select({ version: wikiPages.version }).from(wikiPages).where(eq(wikiPages.id, input.pageId)).get();
  return {
    saved: true as const,
    version: nextVersion,
    layers: extractSvgTextLayers(revision.svg, revision.bindingsJson),
    contentUrl: svgContentUrl(asset.id, nextVersion, page?.version ?? 0),
  };
}

/**
 * `raw` serves the stored artwork untouched. The graphics panel applies the
 * document's typography itself while you are editing, so it needs the drawing
 * without it — applying it twice would compound the font and size match.
 */
export function renderSvgAsset(assetId: string, options: { raw?: boolean } = {}) {
  const row = db.select({
    currentSvg: wikiSvgAssets.currentSvg,
    bindingsJson: wikiSvgAssets.bindingsJson,
    pageTitle: wikiPages.title,
    settingsJson: wikiPages.documentSettingsJson,
    pageOwner: wikiPages.createdBy,
    version: wikiSvgAssets.version,
    sizeScale: wikiSvgAssets.sizeScale,
  }).from(wikiSvgAssets)
    .innerJoin(wikiPages, eq(wikiSvgAssets.pageId, wikiPages.id))
    .where(eq(wikiSvgAssets.id, assetId))
    .get();
  if (!row) return null;
  if (options.raw) return { svg: row.currentSvg, version: row.version };
  const bindings = parseSvgBindings(row.bindingsJson);
  const settings = parseDocumentSettings(row.settingsJson);
  const matchesTypography = settings.diagrams.matchFont || settings.diagrams.matchColor || settings.diagrams.sizeMode !== "off";
  if (!Object.keys(bindings).length && !matchesTypography) return { svg: row.currentSvg, version: row.version };
  const variables: Record<string, string> = { title: row.pageTitle, author: settings.metadata.author, ...settings.variables };
  const document = new DOMParser().parseFromString(row.currentSvg, "image/svg+xml");
  const elements = [
    ...Array.from(document.getElementsByTagName("text")),
    ...Array.from(document.getElementsByTagName("tspan")),
  ];
  for (const [id, key] of Object.entries(bindings)) {
    const element = elements.find((candidate) => candidate.getAttribute("data-wiki-text-id") === id);
    if (!element || !isEditableSvgText(element)) continue;
    setOwnSvgText(element, variables[key] ?? "");
  }
  // Cast at the boundary: the xmldom node types differ from the DOM lib ones,
  // and only the two accessors in SvgElement are used.
  if (matchesTypography) {
    applyDocumentTypography(
      document as unknown as SvgDocument,
      elements as unknown as SvgElement[],
      settings,
      row.sizeScale,
      getWikiTypographyForUser(row.pageOwner),
    );
  }
  const svg = new XMLSerializer().serializeToString(document);
  if (!isSafeInlineSvg(new TextEncoder().encode(svg))) throw new Error("Unsafe SVG result");
  return { svg, version: row.version };
}
