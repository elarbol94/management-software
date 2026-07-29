import "server-only";

import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  attachments,
  wikiPages,
  wikiSvgAssets,
  wikiSvgRevisions,
} from "@/db/schema";
import { getAttachmentAbsolutePath } from "@/lib/files";
import { isSafeInlineSvg } from "@/lib/svg-upload";
import { parseDocumentSettings } from "./lib/document-settings";
import { extractSvgTextLayers, parseSvgBindings, type SvgTextLayer } from "./lib/svg-text";
export type { SvgTextLayer } from "./lib/svg-text";

export type SvgAssetDto = {
  id: string;
  attachmentId: string;
  fileName: string;
  version: number;
  layers: SvgTextLayer[];
  contentUrl: string;
  revisions: Array<{ id: string; version: number; createdAt: string }>;
};

function decodeSvg(buffer: Buffer, fileName: string) {
  const bytes = fileName.toLocaleLowerCase().endsWith(".svgz") || (buffer[0] === 0x1f && buffer[1] === 0x8b)
    ? gunzipSync(buffer)
    : buffer;
  if (!isSafeInlineSvg(bytes)) throw new Error("Unsafe SVG");
  return bytes.toString("utf8");
}

function annotateSvg(svg: string) {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const candidates = [
    ...Array.from(document.getElementsByTagName("text")),
    ...Array.from(document.getElementsByTagName("tspan")),
  ].filter((element) => element.getElementsByTagName("tspan").length === 0);
  candidates.forEach((element, index) => {
    if (!element.getAttribute("data-wiki-text-id")) {
      element.setAttribute("data-wiki-text-id", `svg-text-${index + 1}`);
    }
  });
  return new XMLSerializer().serializeToString(document);
}

export function listSvgAssets(pageId: string, userId: string): SvgAssetDto[] {
  const files = db.select().from(attachments)
    .where(and(eq(attachments.entityType, "wikiPage"), eq(attachments.entityId, pageId)))
    .all()
    .filter((file) => file.mimeType === "image/svg+xml" || /\.svgz?$/i.test(file.fileName));
  for (const file of files) {
    const existing = db.select().from(wikiSvgAssets).where(eq(wikiSvgAssets.attachmentId, file.id)).get();
    if (existing) continue;
    const original = fs.readFileSync(getAttachmentAbsolutePath(file.storedName));
    const currentSvg = annotateSvg(decodeSvg(original, file.fileName));
    db.insert(wikiSvgAssets).values({
      pageId,
      attachmentId: file.id,
      currentSvg,
      updatedBy: userId,
    }).run();
  }
  return db.select({
    id: wikiSvgAssets.id,
    attachmentId: wikiSvgAssets.attachmentId,
    fileName: attachments.fileName,
    version: wikiSvgAssets.version,
    currentSvg: wikiSvgAssets.currentSvg,
    bindingsJson: wikiSvgAssets.bindingsJson,
  })
    .from(wikiSvgAssets)
    .innerJoin(attachments, eq(wikiSvgAssets.attachmentId, attachments.id))
    .where(eq(wikiSvgAssets.pageId, pageId))
    .all()
    .map((asset) => {
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
        layers: extractSvgTextLayers(asset.currentSvg, asset.bindingsJson),
        contentUrl: `/api/wiki/svg-assets/${asset.id}/content?v=${asset.version}`,
        revisions,
      };
    });
}

export function updateSvgAsset(input: {
  pageId: string;
  assetId: string;
  expectedVersion: number;
  layers: SvgTextLayer[];
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
    if (!element || element.getElementsByTagName("tspan").length > 0) continue;
    while (element.firstChild) element.removeChild(element.firstChild);
    element.appendChild(document.createTextNode(layer.text.slice(0, 10_000)));
    if (layer.binding) bindings[layer.id] = layer.binding.slice(0, 50);
  }
  const nextSvg = new XMLSerializer().serializeToString(document);
  if (!isSafeInlineSvg(new TextEncoder().encode(nextSvg))) throw new Error("Unsafe SVG result");
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
      bindingsJson: JSON.stringify(bindings),
      version: nextVersion,
      updatedBy: input.userId,
      updatedAt: new Date(),
    }).where(and(eq(wikiSvgAssets.id, asset.id), eq(wikiSvgAssets.version, asset.version))).run();
  });
  return {
    saved: true as const,
    version: nextVersion,
    layers: extractSvgTextLayers(nextSvg, JSON.stringify(bindings)),
    contentUrl: `/api/wiki/svg-assets/${asset.id}/content?v=${nextVersion}`,
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
  return {
    saved: true as const,
    version: nextVersion,
    layers: extractSvgTextLayers(revision.svg, revision.bindingsJson),
    contentUrl: `/api/wiki/svg-assets/${asset.id}/content?v=${nextVersion}`,
  };
}

export function renderSvgAsset(assetId: string) {
  const row = db.select({
    currentSvg: wikiSvgAssets.currentSvg,
    bindingsJson: wikiSvgAssets.bindingsJson,
    pageTitle: wikiPages.title,
    settingsJson: wikiPages.documentSettingsJson,
    version: wikiSvgAssets.version,
  }).from(wikiSvgAssets)
    .innerJoin(wikiPages, eq(wikiSvgAssets.pageId, wikiPages.id))
    .where(eq(wikiSvgAssets.id, assetId))
    .get();
  if (!row) return null;
  const bindings = parseSvgBindings(row.bindingsJson);
  if (!Object.keys(bindings).length) return { svg: row.currentSvg, version: row.version };
  const settings = parseDocumentSettings(row.settingsJson);
  const variables: Record<string, string> = { title: row.pageTitle, author: settings.metadata.author, ...settings.variables };
  const document = new DOMParser().parseFromString(row.currentSvg, "image/svg+xml");
  const elements = [
    ...Array.from(document.getElementsByTagName("text")),
    ...Array.from(document.getElementsByTagName("tspan")),
  ];
  for (const [id, key] of Object.entries(bindings)) {
    const element = elements.find((candidate) => candidate.getAttribute("data-wiki-text-id") === id);
    if (!element || element.getElementsByTagName("tspan").length > 0) continue;
    while (element.firstChild) element.removeChild(element.firstChild);
    element.appendChild(document.createTextNode(variables[key] ?? ""));
  }
  const svg = new XMLSerializer().serializeToString(document);
  if (!isSafeInlineSvg(new TextEncoder().encode(svg))) throw new Error("Unsafe SVG result");
  return { svg, version: row.version };
}
