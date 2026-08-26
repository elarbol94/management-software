/**
 * Shared between the server-side embedder and the offline backfill script, so it holds
 * no server-only imports.
 */
import path from "node:path";

/** multilingual-e5-small: 384 dimensions, and the German/English pair this app needs. */
export const EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
export const EMBEDDING_DIMENSIONS = 384;

/**
 * e5 models are trained with these prefixes and lose accuracy without them: stored text
 * is a "passage", the thing being searched for is a "query".
 */
export function withPrefix(texts: string[], kind: "query" | "passage") {
  return texts.map((text) => `${kind}: ${text.replace(/\s+/g, " ").trim()}`);
}

/**
 * Where the model weights are cached, ~130MB of them.
 *
 * transformers.js defaults to a directory inside node_modules, which the container image
 * rebuilds, so the download would repeat after every deploy. Both the app and the
 * backfill script call this so they share one copy on the mounted data volume.
 */
export function modelCacheDir() {
  const databasePath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db");
  return path.join(path.dirname(databasePath), "models");
}
