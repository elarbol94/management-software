import "server-only";

import { EMBEDDING_MODEL, withPrefix } from "./embedding-config";

export { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "./embedding-config";


type Embedder = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{
  tolist(): number[][];
}>;

let embedderPromise: Promise<Embedder | null> | null = null;

/**
 * Loads the embedding model once per process. Returns null rather than throwing when the
 * model or its runtime is unavailable, so a server without it keeps working with keyword
 * search alone instead of failing every save.
 */
async function getEmbedder(): Promise<Embedder | null> {
  embedderPromise ??= (async () => {
    try {
      const { pipeline } = await import("@huggingface/transformers");
      // Quantised weights: roughly a quarter of the memory, no measurable quality loss
      // at this model size, and it keeps the container image reasonable.
      return await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" }) as unknown as Embedder;
    } catch (error) {
      console.warn(JSON.stringify({
        event: "embedding_model_unavailable",
        reason: error instanceof Error ? error.message : "unknown",
      }));
      return null;
    }
  })();
  return embedderPromise;
}

export async function isEmbeddingAvailable() {
  return (await getEmbedder()) !== null;
}


export async function embedPassages(texts: string[]): Promise<Float32Array[] | null> {
  if (!texts.length) return [];
  const embedder = await getEmbedder();
  if (!embedder) return null;
  const output = await embedder(withPrefix(texts, "passage"), { pooling: "mean", normalize: true });
  return output.tolist().map((vector) => Float32Array.from(vector));
}

export async function embedQuery(text: string): Promise<Float32Array | null> {
  const embedder = await getEmbedder();
  if (!embedder) return null;
  const output = await embedder(withPrefix([text], "query"), { pooling: "mean", normalize: true });
  return Float32Array.from(output.tolist()[0]);
}
