import "server-only";

import { createHash } from "node:crypto";
import { sqlite } from "@/db";
import { EMBEDDING_DIMENSIONS, embedPassages, embedQuery } from "./embeddings.server";
import { chunkText } from "./chunking";

export type VectorHit = {
  kind: "page" | "pdfPage";
  refId: string;
  pageNumber: number;
  text: string;
  distance: number;
};

let vectorState: "unchecked" | "ready" | "unavailable" = "unchecked";

/**
 * Loads sqlite-vec and creates the vector table on first use.
 *
 * This is deliberately not done in src/db/index.ts: the extension ships prebuilt
 * binaries per platform, and a container the binary does not cover must still start and
 * serve keyword search rather than failing at boot.
 */
function ensureVectorTable(): boolean {
  if (vectorState !== "unchecked") return vectorState === "ready";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqliteVec = require("sqlite-vec") as { load: (db: unknown) => void };
    sqliteVec.load(sqlite);
    sqlite.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS wiki_embedding_vectors USING vec0(embedding float[${EMBEDDING_DIMENSIONS}])`,
    );
    vectorState = "ready";
  } catch (error) {
    console.warn(JSON.stringify({
      event: "vector_search_unavailable",
      reason: error instanceof Error ? error.message : "unknown",
    }));
    vectorState = "unavailable";
  }
  return vectorState === "ready";
}

export function isVectorSearchAvailable() {
  return ensureVectorTable();
}

function hashOf(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/**
 * Re-embeds one page or PDF page. Chunks whose text is unchanged keep their vector, so
 * saving a document repeatedly costs nothing after the first time.
 */
export async function indexText(input: {
  kind: "page" | "pdfPage";
  refId: string;
  pageNumber?: number;
  text: string;
}): Promise<{ indexed: number; skipped: number } | null> {
  if (!ensureVectorTable()) return null;
  const pageNumber = input.pageNumber ?? 0;
  const chunks = chunkText(input.text);

  const existing = sqlite.prepare(
    "SELECT id, chunk_index AS chunkIndex, content_hash AS contentHash FROM wiki_embeddings WHERE kind = ? AND ref_id = ? AND page_number = ?",
  ).all(input.kind, input.refId, pageNumber) as Array<{ id: number; chunkIndex: number; contentHash: string }>;
  const byIndex = new Map(existing.map((row) => [row.chunkIndex, row]));

  // Chunks that fell off the end when the text shrank.
  const stale = existing.filter((row) => row.chunkIndex >= chunks.length);
  const needed = chunks
    .map((text, chunkIndex) => ({ text, chunkIndex, hash: hashOf(text) }))
    .filter((chunk) => byIndex.get(chunk.chunkIndex)?.contentHash !== chunk.hash);

  if (stale.length) {
    const ids = stale.map((row) => row.id);
    const holes = ids.map(() => "?").join(",");
    sqlite.prepare(`DELETE FROM wiki_embedding_vectors WHERE rowid IN (${holes})`).run(...ids);
    sqlite.prepare(`DELETE FROM wiki_embeddings WHERE id IN (${holes})`).run(...ids);
  }
  if (!needed.length) return { indexed: 0, skipped: chunks.length };

  const vectors = await embedPassages(needed.map((chunk) => chunk.text));
  if (!vectors) return null;

  const upsertMeta = sqlite.prepare(`
    INSERT INTO wiki_embeddings (kind, ref_id, page_number, chunk_index, content_hash, text, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kind, ref_id, page_number, chunk_index)
    DO UPDATE SET content_hash = excluded.content_hash, text = excluded.text, updated_at = excluded.updated_at
    RETURNING id
  `);
  const deleteVector = sqlite.prepare("DELETE FROM wiki_embedding_vectors WHERE rowid = ?");
  const insertVector = sqlite.prepare("INSERT INTO wiki_embedding_vectors (rowid, embedding) VALUES (?, ?)");

  sqlite.transaction(() => {
    needed.forEach((chunk, position) => {
      const { id } = upsertMeta.get(
        input.kind, input.refId, pageNumber, chunk.chunkIndex, chunk.hash, chunk.text, Date.now(),
      ) as { id: number };
      // vec0 has no upsert, so replace the row.
      deleteVector.run(BigInt(id));
      insertVector.run(BigInt(id), vectors[position]);
    });
  })();

  return { indexed: needed.length, skipped: chunks.length - needed.length };
}

/** Drops every vector for one page or document, e.g. when it is deleted. */
export function removeFromIndex(kind: "page" | "pdfPage", refId: string) {
  if (!ensureVectorTable()) return;
  const rows = sqlite.prepare("SELECT id FROM wiki_embeddings WHERE kind = ? AND ref_id = ?")
    .all(kind, refId) as Array<{ id: number }>;
  if (!rows.length) return;
  const holes = rows.map(() => "?").join(",");
  const ids = rows.map((row) => row.id);
  sqlite.transaction(() => {
    sqlite.prepare(`DELETE FROM wiki_embedding_vectors WHERE rowid IN (${holes})`).run(...ids);
    sqlite.prepare(`DELETE FROM wiki_embeddings WHERE id IN (${holes})`).run(...ids);
  })();
}

/**
 * Nearest chunks to a query. Returns null when semantic search is unavailable, so the
 * caller can fall back to keyword results rather than showing an error.
 */
/**
 * Distance beyond which a match is treated as noise.
 *
 * ponytail: empirical, not principled. This model's distances sit in a narrow band --
 * on real content a good match measured ~0.53 while unrelated text measured ~0.57 --
 * so without a ceiling every query returns its full k regardless of relevance, and that
 * noise then competes with real keyword hits in the fused ranking. Raise it if genuine
 * matches go missing; a reranker would replace the constant properly.
 */
const MAX_SEMANTIC_DISTANCE = 0.56;

export async function searchSimilar(query: string, limit = 20): Promise<VectorHit[] | null> {
  if (!ensureVectorTable()) return null;
  const vector = await embedQuery(query);
  if (!vector) return null;
  const rows = sqlite.prepare(`
    SELECT m.kind, m.ref_id AS refId, m.page_number AS pageNumber, m.text, v.distance
    FROM wiki_embedding_vectors v
    JOIN wiki_embeddings m ON m.id = v.rowid
    WHERE v.embedding MATCH ? AND k = ?
    ORDER BY v.distance
  `).all(vector, limit) as VectorHit[];
  return rows.filter((row) => row.distance <= MAX_SEMANTIC_DISTANCE);
}
