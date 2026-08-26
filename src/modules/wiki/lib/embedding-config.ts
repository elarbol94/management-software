/**
 * Shared between the server-side embedder and the offline backfill script, so it holds
 * no server-only imports.
 */

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
