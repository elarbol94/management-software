/**
 * Splits text into overlapping chunks. A whole page embedded as one vector averages away
 * whatever makes a passage findable; the overlap stops a sentence that straddles a
 * boundary from being lost by both neighbours.
 */
/**
 * Whether a chunk carries enough language to be worth a vector. PDF extraction produces
 * fragments like "/" or a bare page number, and an embedding of those is noise that
 * still competes for a place in the results.
 */
export function isMeaningfulChunk(chunk: string) {
  const letters = chunk.replace(/[^\p{L}]/gu, "").length;
  return chunk.trim().length >= 30 && letters >= 15;
}

export function chunkText(text: string, size = 900, overlap = 150): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  // The short-text path needs the same filter, or a one-line fragment slips through.
  if (clean.length <= size) return isMeaningfulChunk(clean) ? [clean] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      // Prefer a sentence or word boundary so chunks read as text, not fragments.
      const window = clean.slice(start, end);
      const boundary = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
      if (boundary > size * 0.5) end = start + boundary + 1;
      else {
        const space = window.lastIndexOf(" ");
        if (space > size * 0.5) end = start + space;
      }
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter((chunk) => Boolean(chunk) && isMeaningfulChunk(chunk));
}
