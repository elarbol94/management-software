import { mapSpellcheckMatches, type ProofingLanguage, type SpellcheckBatch, type SpellcheckIssue, type SpellcheckParagraph, type SpellcheckResponseMatch } from "./spellcheck";
import { collectSpellcheckUnits } from "./spellcheck-units";

type CachedMatch = Omit<SpellcheckResponseMatch, "paragraph">;
export type ProofingStatus = "ready" | "checking" | "error";
export type ProofingTiming = { queueMs: number; requestMs: number; applyMs: number; characters: number; items: number; outcome: "success" | "error" | "cancelled" };
type Job = { texts: string[]; abort: AbortController; started: number; queueMs: number };

/** One small background request plus a reserved lane for the latest edit.
 * Results are keyed by exact sentence context and mapped onto the live document. */
export function createSpellcheckController(options: {
  snapshot: () => { paragraphs: SpellcheckParagraph[]; cursor: number; issues?: SpellcheckIssue[] };
  request: (batch: SpellcheckBatch, signal: AbortSignal) => Promise<SpellcheckResponseMatch[]>;
  publish: (issues: SpellcheckIssue[]) => void;
  status: (status: ProofingStatus) => void;
  language?: ProofingLanguage;
  composing?: () => boolean;
  timing?: (timing: ProofingTiming) => void;
}) {
  const cache = new Map<string, CachedMatch[]>();
  const lifetime = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let foreground: Job | undefined, background: Job | undefined;
  let retryAt = 0, failures = 0, editAt = performance.now(), debounceUntil = 0;
  let lastParagraphs: SpellcheckParagraph[] | undefined;
  let units: ReturnType<typeof collectSpellcheckUnits> = [];
  const unitCache = new Map<string, typeof units>();

  function read() {
    const { paragraphs, cursor, issues = [] } = options.snapshot();
    if (paragraphs !== lastParagraphs) {
      units = paragraphs.flatMap((paragraph, index) => {
        let cached = unitCache.get(paragraph.text);
        if (!cached) {
          cached = collectSpellcheckUnits([paragraph], options.language ?? "de-DE");
          unitCache.set(paragraph.text, cached);
        }
        return cached.map((unit) => ({ ...unit, paragraph: index }));
      });
      const activeText = new Set(paragraphs.map((paragraph) => paragraph.text));
      for (const key of unitCache.keys()) if (!activeText.has(key)) unitCache.delete(key);
      lastParagraphs = paragraphs;
    }
    const checked = units.filter((unit) => cache.has(unit.text));
    const matches = checked.flatMap((unit) => cache.get(unit.text)!.flatMap((match) => {
      const offset = unit.contextOffset + match.offset;
      // Each sentence owns matches starting in it, including cross-sentence
      // grammar spans. Context-only matches belong to their own sentence unit.
      return offset >= unit.offset && offset < unit.end && match.offset + match.length <= unit.text.length
        ? [{ ...match, paragraph: unit.paragraph, offset }] : [];
    }));
    const fresh = mapSpellcheckMatches(paragraphs, matches);
    // Both ranges and hints follow document order. A single sweep avoids a
    // quadratic scan when a long document already contains many suggestions.
    const ranges = checked.map((unit) => ({ from: paragraphs[unit.paragraph].from + unit.offset, to: paragraphs[unit.paragraph].from + unit.end }));
    let rangeIndex = 0;
    const retained = [...issues].sort((a, b) => a.from - b.from).filter((issue) => {
      while (rangeIndex < ranges.length && ranges[rangeIndex].to <= issue.from) rangeIndex++;
      return rangeIndex === ranges.length || ranges[rangeIndex].from > issue.from;
    });
    options.publish([...retained, ...fresh].sort((a, b) => a.from - b.from || a.to - b.to));
    const missing = units.filter((unit) => !cache.has(unit.text));
    const priority = missing.find((unit) => {
      const from = paragraphs[unit.paragraph].from;
      return from + unit.offset <= cursor && cursor <= from + unit.end;
    });
    const active = new Set(units.map((unit) => unit.text));
    for (const key of cache.keys()) {
      if (cache.size <= Math.max(500, active.size)) break;
      if (!active.has(key)) cache.delete(key);
    }
    return { missing, priority, active };
  }

  function wake() {
    if (lifetime.signal.aborted) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; run(); }, Math.max(0, debounceUntil - Date.now(), retryAt - Date.now()));
  }

  function run() {
    if (lifetime.signal.aborted) return;
    if (options.composing?.()) { debounceUntil = Date.now() + 250; wake(); return; }
    const { missing, priority, active } = read();
    for (const job of [foreground, background]) {
      if (job && !job.texts.some((text) => active.has(text))) {
        job.abort.abort();
        if (foreground === job) foreground = undefined;
        if (background === job) background = undefined;
      }
    }
    options.status(missing.length ? failures ? "error" : "checking" : "ready");
    const inFlight = (text: string) => [foreground, background].some((job) => job?.texts.includes(text));
    if (priority && !inFlight(priority.text)) {
      if (foreground) {
        if (!background) background = foreground;
        else foreground.abort.abort();
      }
      foreground = launch([priority.text]);
      return;
    }
    if (!background) {
      const texts: string[] = [];
      let size = 0;
      for (const unit of missing) {
        if (inFlight(unit.text) || texts.includes(unit.text)) continue;
        if (texts.length && (texts.length >= 8 || size + unit.text.length > 4_000)) break;
        texts.push(unit.text); size += unit.text.length;
      }
      if (texts.length) background = launch(texts);
    }
  }

  function launch(texts: string[]): Job {
    const job: Job = { texts, abort: new AbortController(), started: performance.now(), queueMs: Math.max(0, performance.now() - editAt) };
    const batch: SpellcheckBatch = { items: texts.map((text, paragraph) => ({ text, paragraph, offset: 0 })) };
    const signal = AbortSignal.any([lifetime.signal, job.abort.signal, AbortSignal.timeout(8_000)]);
    void (async () => {
      let outcome: ProofingTiming["outcome"] = "success", requestMs = 0, applyMs = 0;
      try {
        const matches = await Promise.resolve().then(() => options.request(batch, signal));
        requestMs = performance.now() - job.started;
        if (signal.aborted) return;
        texts.forEach((text, index) => cache.set(text, matches.filter((match) => match.paragraph === index)
          .map(({ paragraph: _paragraph, ...match }) => { void _paragraph; return match; })));
        failures = 0; retryAt = 0;
        if (!options.composing?.()) {
          const started = performance.now();
          const { missing } = read();
          applyMs = performance.now() - started;
          options.status(missing.length ? "checking" : "ready");
        }
      } catch {
        if (job.abort.signal.aborted || lifetime.signal.aborted) return;
        outcome = "error";
        options.status("error");
        retryAt = Date.now() + Math.min(30_000, 5_000 * 2 ** failures++);
      } finally {
        if (job.abort.signal.aborted || lifetime.signal.aborted) outcome = "cancelled";
        options.timing?.({ queueMs: job.queueMs, requestMs: requestMs || performance.now() - job.started, applyMs,
          characters: texts.reduce((sum, text) => sum + text.length, 0), items: texts.length, outcome });
        if (foreground === job) foreground = undefined;
        if (background === job) background = undefined;
        wake();
      }
    })();
    return job;
  }

  return {
    start: wake,
    schedule: () => {
      editAt = performance.now(); debounceUntil = Date.now() + 250;
      if (!failures) options.status("checking");
      wake();
    },
    retry: () => { retryAt = 0; debounceUntil = 0; wake(); },
    dispose: () => { lifetime.abort(); clearTimeout(timer); cache.clear(); unitCache.clear(); },
  };
}
