import { createSpellcheckBatches, mapSpellcheckMatches, remapSpellcheckBatchMatches, type SpellcheckBatch, type SpellcheckIssue, type SpellcheckParagraph, type SpellcheckResponseMatch } from "./spellcheck";

type CachedMatch = Omit<SpellcheckResponseMatch, "paragraph">;
export type ProofingStatus = "ready" | "checking" | "error";

/** One request at a time. Typing never cancels useful work; results are applied
 * by exact text against the latest document, never by an old document offset. */
export function createSpellcheckController(options: {
  snapshot: () => { paragraphs: SpellcheckParagraph[]; cursor: number };
  request: (batch: SpellcheckBatch, signal: AbortSignal) => Promise<SpellcheckResponseMatch[]>;
  publish: (issues: SpellcheckIssue[]) => void;
  status: (status: ProofingStatus) => void;
  composing?: () => boolean;
}) {
  const cache = new Map<string, CachedMatch[]>();
  const lifetime = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let retryAt = 0;
  let failures = 0;

  function read() {
    const { paragraphs, cursor } = options.snapshot();
    const items = createSpellcheckBatches(paragraphs).flatMap((batch) => batch.items);
    const matches = items.flatMap((item) => (cache.get(item.text) ?? []).map((match) => ({ ...match, paragraph: item.paragraph, offset: item.offset + match.offset })));
    options.publish(mapSpellcheckMatches(paragraphs, matches));
    const missing = items.filter((item) => !cache.has(item.text));
    const priority = missing.find((item) => {
      const paragraph = paragraphs[item.paragraph];
      return paragraph.from + item.offset <= cursor && cursor <= paragraph.from + item.offset + item.text.length;
    });
    const unique = [...new Set((priority ? [priority] : missing).map((item) => item.text))];
    const batch = createSpellcheckBatches(unique.map((text) => ({ text, from: 0, excludedRanges: [] })))[0];
    // Retain results for all current blocks, even in documents exceeding the
    // historical cache limit; eviction must not cause an endless recheck loop.
    const active = new Set(items.map((item) => item.text));
    for (const key of cache.keys()) {
      if (cache.size <= Math.max(500, active.size)) break;
      if (!active.has(key)) cache.delete(key);
    }
    return batch;
  }

  function schedule(delay = 250) {
    if (lifetime.signal.aborted) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void run(); }, Math.max(delay, retryAt - Date.now()));
  }

  async function run() {
    if (running || lifetime.signal.aborted) return;
    if (options.composing?.()) { schedule(); return; }
    const batch = read();
    if (!batch) { options.status("ready"); return; }
    running = true;
    if (!failures) options.status("checking");
    try {
      const matches = await options.request(batch, AbortSignal.any([lifetime.signal, AbortSignal.timeout(8_000)]));
      if (lifetime.signal.aborted) return;
      const remapped = remapSpellcheckBatchMatches(batch, matches);
      batch.items.forEach((item) => cache.set(item.text, remapped.filter((match) => match.paragraph === item.paragraph)
        .map(({ paragraph: _paragraph, ...match }) => { void _paragraph; return match; })));
      failures = 0;
      retryAt = 0;
      if (options.composing?.()) { schedule(); return; }
      const next = read();
      options.status(next ? "checking" : "ready");
      if (next && !timer) schedule(0);
    } catch {
      if (lifetime.signal.aborted) return;
      options.status("error");
      retryAt = Date.now() + Math.min(30_000, 5_000 * 2 ** failures++);
      schedule();
    } finally {
      running = false;
    }
  }

  return {
    start: () => schedule(0),
    schedule: () => schedule(),
    retry: () => { retryAt = 0; schedule(0); },
    dispose: () => { lifetime.abort(); clearTimeout(timer); cache.clear(); },
  };
}
