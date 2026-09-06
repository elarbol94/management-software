import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { relativeFigurePath } from "./figure";

const rootsSchema = z.record(z.string().regex(/^[\w-]{1,60}$/), z.string().min(1));
export function figureServerRoots() {
  try { return rootsSchema.parse(JSON.parse(process.env.WIKI_FIGURE_ROOTS || "{}")); }
  catch { return {}; }
}
export function pathWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export async function resolveFigureServerPath(rootKey: string, input: string) {
  const root = figureServerRoots()[rootKey];
  if (!root || !path.isAbsolute(root)) throw new Error("sourceUnavailable");
  const configured = path.resolve(root);
  const relative = path.isAbsolute(input) ? path.relative(configured, input).replace(/\\/g, "/") : input;
  const normalized = relativeFigurePath(relative);
  const realRoot = await fs.realpath(configured);
  const absolute = await fs.realpath(path.join(configured, normalized));
  if (!pathWithin(realRoot, absolute)) throw new Error("invalidPath");
  return { absolute, relativePath: normalized, realRoot };
}

/** Re-resolve the name on every read: scientific tools commonly rename a temporary file over it. */
export async function readFigureServerFile(rootKey: string, input: string, limit: number) {
  const resolved = await resolveFigureServerPath(rootKey, input);
  const handle = await fs.open(resolved.absolute, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > limit) throw new Error("invalidFile");
    // Compare the opened inode with a fresh, confined resolution before reading any bytes.
    const fresh = await resolveFigureServerPath(rootKey, input);
    const current = await fs.stat(fresh.absolute);
    if (fresh.absolute !== resolved.absolute || current.ino !== before.ino || current.dev !== before.dev) throw new Error("fileChanging");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error("fileChanging");
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("fileChanging");
    return { bytes, relativePath: resolved.relativePath };
  } finally { await handle.close(); }
}
