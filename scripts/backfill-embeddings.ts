/**
 * Embeds wiki pages and PDF page text that predate semantic search.
 *
 * Safe to re-run: chunks whose text is unchanged keep their vector, so a second pass
 * costs a hash comparison per chunk and nothing else.
 *
 *   npm run wiki:backfill-embeddings -- [--limit N]
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { pipeline } from "@huggingface/transformers";
// The same chunking the application uses. A second copy here silently drifted once
// already, so the script imports it rather than restating it.
import { chunkText } from "../src/modules/wiki/lib/chunking";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, withPrefix } from "../src/modules/wiki/lib/embedding-config";

const require = createRequire(import.meta.url);
const sqliteVec = require("sqlite-vec") as { load: (db: unknown) => void };

const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db");

const db = new Database(dbPath);
sqliteVec.load(db);
db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS wiki_embedding_vectors USING vec0(embedding float[${EMBEDDING_DIMENSIONS}])`);

// tsx compiles this as CJS, where top-level await is unavailable.
async function main() {
  type Embedder = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
  const embed = await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" }) as unknown as Embedder;

  const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32);

  const meta = db.prepare(`INSERT INTO wiki_embeddings (kind, ref_id, page_number, chunk_index, content_hash, text, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kind, ref_id, page_number, chunk_index)
    DO UPDATE SET content_hash = excluded.content_hash, text = excluded.text, updated_at = excluded.updated_at
    RETURNING id`);
  const dropVector = db.prepare("DELETE FROM wiki_embedding_vectors WHERE rowid = ?");
  const addVector = db.prepare("INSERT INTO wiki_embedding_vectors (rowid, embedding) VALUES (?, ?)");
  const existing = db.prepare("SELECT content_hash AS h FROM wiki_embeddings WHERE kind = ? AND ref_id = ? AND page_number = ? AND chunk_index = ?");

  let indexed = 0;
  let skipped = 0;

  async function indexOne(kind: "page" | "pdfPage", refId: string, pageNumber: number, text: string) {
    const chunks = chunkText(text);
    const pending = chunks
      .map((value, index) => ({ value, index, hash: hash(value) }))
      .filter((chunk) => (existing.get(kind, refId, pageNumber, chunk.index) as { h: string } | undefined)?.h !== chunk.hash);
    if (!pending.length) { skipped += chunks.length; return; }
    const output = await embed(withPrefix(pending.map((chunk) => chunk.value), "passage"), { pooling: "mean", normalize: true });
    const vectors = output.tolist().map((vector) => Float32Array.from(vector));
    db.transaction(() => {
      pending.forEach((chunk, position) => {
        const { id } = meta.get(kind, refId, pageNumber, chunk.index, chunk.hash, chunk.value, Date.now()) as { id: number };
        dropVector.run(BigInt(id));
        addVector.run(BigInt(id), vectors[position]);
      });
    })();
    indexed += pending.length;
  }

  const pages = db.prepare("SELECT id, title, content_text AS text FROM wiki_pages WHERE deleted_at IS NULL")
    .all() as Array<{ id: string; title: string; text: string | null }>;
  for (const [position, page] of pages.entries()) {
    if (position >= limit) break;
    await indexOne("page", page.id, 0, `${page.title}\n\n${page.text ?? ""}`);
    process.stdout.write(`\rpages ${position + 1}/${pages.length}  indexed ${indexed} skipped ${skipped}   `);
  }
  console.log();

  const pdfPages = db.prepare(`SELECT p.document_id AS documentId, p.page_number AS pageNumber, p.text
    FROM wiki_pdf_pages p JOIN wiki_pdf_documents d ON d.id = p.document_id
    WHERE d.status = 'ready' AND length(trim(p.text)) > 0`)
    .all() as Array<{ documentId: string; pageNumber: number; text: string }>;
  for (const [position, page] of pdfPages.entries()) {
    if (position >= limit) break;
    await indexOne("pdfPage", page.documentId, page.pageNumber, page.text);
    process.stdout.write(`\rpdf pages ${position + 1}/${pdfPages.length}  indexed ${indexed} skipped ${skipped}   `);
  }
  console.log(`\ndone: ${indexed} chunks embedded, ${skipped} unchanged`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
