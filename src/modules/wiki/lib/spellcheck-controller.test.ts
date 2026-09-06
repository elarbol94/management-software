import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpellcheckController } from "./spellcheck-controller";
import type { SpellcheckBatch, SpellcheckIssue, SpellcheckResponseMatch } from "./spellcheck";

const typo = (paragraph = 0): SpellcheckResponseMatch => ({ paragraph, offset: 0, length: 3, message: "Typo", kind: "spelling", category: "Spelling", ruleId: "TYPO", replacements: ["The"] });
const prose = (text: string, from = 1) => ({ text, from, excludedRanges: [] });

describe("incremental proofing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("checks the latest edit while a slow background check is still running", async () => {
    let snapshot = { paragraphs: [prose("Ready text"), prose("Slow background", 30)], cursor: 1 };
    let release!: (matches: SpellcheckResponseMatch[]) => void;
    const request = vi.fn(async (batch: SpellcheckBatch) => {
      if (batch.items.some((item) => item.text === "Slow background")) return new Promise<SpellcheckResponseMatch[]>((resolve) => { release = resolve; });
      await new Promise((resolve) => setTimeout(resolve, 400));
      return batch.items[0].text === "Teh latest" ? [typo()] : [];
    });
    const publish = vi.fn(), timing = vi.fn();
    const checker = createSpellcheckController({ snapshot: () => snapshot, request, publish, timing, status: vi.fn() });
    checker.start();
    await vi.advanceTimersByTimeAsync(450);
    expect(request).toHaveBeenCalledTimes(2);
    snapshot = { paragraphs: [prose("Teh latest"), prose("Slow background", 30)], cursor: 1 };
    checker.schedule();
    await vi.advanceTimersByTimeAsync(650);
    expect(publish).toHaveBeenLastCalledWith([expect.objectContaining({ from: 1, to: 4 })]);
    expect(timing).toHaveBeenLastCalledWith(expect.objectContaining({ queueMs: 250, requestMs: 400, outcome: "success" }));
    release([]);
    await vi.advanceTimersByTimeAsync(10);
    checker.dispose();
  });

  it("cancels superseded edits, coalesces typing and rejects late cancelled results", async () => {
    let snapshot = { paragraphs: [prose("Teh old")], cursor: 1 };
    const releases: Array<(matches: SpellcheckResponseMatch[]) => void> = [];
    const request = vi.fn<(batch: SpellcheckBatch, signal: AbortSignal) => Promise<SpellcheckResponseMatch[]>>(() => new Promise((resolve) => { releases.push(resolve); }));
    const publish = vi.fn();
    const checker = createSpellcheckController({ snapshot: () => snapshot, request, publish, status: vi.fn() });
    checker.start();
    await vi.advanceTimersByTimeAsync(0);
    for (const text of ["Teh intermediate", "The final sentence"]) {
      snapshot = { paragraphs: [prose(text)], cursor: 1 };
      checker.schedule();
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1].aborted).toBe(true);
    expect(request.mock.calls[1][0].items[0].text).toBe("The final sentence");
    releases[1]([]);
    releases[0]([typo()]);
    await vi.advanceTimersByTimeAsync(10);
    expect(publish.mock.calls.every(([issues]) => issues.length === 0)).toBe(true);
    checker.dispose();
  });

  it("keeps mapped hints during a sentence recheck and reuses distant sentence results", async () => {
    const original = "Teh first. Teh second. Teh third. Teh fourth. Teh fifth. Teh sixth.";
    let snapshot: { paragraphs: ReturnType<typeof prose>[]; cursor: number; issues: SpellcheckIssue[] } = { paragraphs: [prose(original)], cursor: 3, issues: [] };
    let hold = false;
    const releases: Array<() => void> = [];
    const request = vi.fn(async (batch: SpellcheckBatch) => {
      if (hold) await new Promise<void>((resolve) => { releases.push(resolve); });
      return batch.items.flatMap((item, paragraph) => [...item.text.matchAll(/Teh/g)].map((match) => ({ ...typo(paragraph), offset: match.index! })));
    });
    const checker = createSpellcheckController({ snapshot: () => snapshot, request, publish: (issues) => { snapshot.issues = issues; }, status: vi.fn() });
    checker.start();
    await vi.advanceTimersByTimeAsync(20);
    expect(snapshot.issues).toHaveLength(6);
    const initialCalls = request.mock.calls.length;
    hold = true;
    // The editor has removed only the corrected word and mapped the other hints.
    snapshot = { paragraphs: [prose(original.replace("Teh", "The"))], cursor: 4, issues: snapshot.issues.slice(1) };
    checker.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(snapshot.issues).toHaveLength(5);
    expect(request.mock.calls[initialCalls][0].items[0].text).toBe("The first. Teh second. ");
    hold = false;
    releases.forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(20);
    expect(snapshot.issues).toHaveLength(5);
    const checkedText = request.mock.calls.slice(initialCalls).flatMap(([batch]) => batch.items.map((item) => item.text)).join("");
    expect(checkedText).not.toContain("fourth");
    checker.dispose();
  });

  it("finishes useful work while typing and maps cached results onto current positions", async () => {
    let snapshot = { paragraphs: [prose("Teh first"), prose("Teh second", 20)], cursor: 1 };
    let finish!: (matches: SpellcheckResponseMatch[]) => void;
    const request = vi.fn<(batch: SpellcheckBatch, signal: AbortSignal) => Promise<SpellcheckResponseMatch[]>>(() => new Promise((resolve) => { finish = resolve; }));
    const publish = vi.fn();
    const checker = createSpellcheckController({ snapshot: () => snapshot, request, publish, status: vi.fn() });
    checker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls[0][0].items.map((item) => item.text)).toEqual(["Teh first"]);
    snapshot = { paragraphs: [prose("Extra prose"), prose("Teh first", 30)], cursor: 2 };
    for (let i = 0; i < 5; i++) { checker.schedule(); await vi.advanceTimersByTimeAsync(150); }
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1].aborted).toBe(false);
    finish([typo()]);
    await vi.advanceTimersByTimeAsync(100);
    expect(publish).toHaveBeenCalledWith([expect.objectContaining({ from: 30, to: 33 })]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].items.map((item) => item.text)).toEqual(["Extra prose"]);
    checker.dispose();
  });

  it("never publishes a response for text that was replaced during the request", async () => {
    let snapshot = { paragraphs: [prose("Teh old")], cursor: 1 };
    let finish!: (matches: SpellcheckResponseMatch[]) => void;
    const publish = vi.fn();
    const checker = createSpellcheckController({ snapshot: () => snapshot, publish, status: vi.fn(),
      request: () => new Promise((resolve) => { finish = resolve; }),
    });
    checker.start();
    await vi.advanceTimersByTimeAsync(0);
    snapshot = { paragraphs: [prose("The new")], cursor: 1 };
    checker.schedule();
    finish([typo()]);
    await vi.advanceTimersByTimeAsync(10);
    expect(publish.mock.calls.every(([issues]) => issues.length === 0)).toBe(true);
    checker.dispose();
  });

  it("deduplicates identical blocks and reuses unchanged results after an edit", async () => {
    let snapshot = { paragraphs: [prose("Teh one"), prose("Teh one", 20)], cursor: 1 };
    const request = vi.fn(async () => [typo()]);
    const publish = vi.fn();
    const status = vi.fn();
    const checker = createSpellcheckController({ snapshot: () => snapshot, request, publish, status });
    checker.start();
    await vi.advanceTimersByTimeAsync(5);
    expect(request).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith([expect.objectContaining({ from: 1 }), expect.objectContaining({ from: 20 })]);
    snapshot = { paragraphs: [prose("Teh one", 40)], cursor: 40 };
    checker.schedule();
    await vi.advanceTimersByTimeAsync(250);
    expect(request).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith("ready");
    checker.dispose();
  });

  it("retries an unavailable service with backoff and recovers without another edit", async () => {
    const status = vi.fn();
    const request = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    const checker = createSpellcheckController({ snapshot: () => ({ paragraphs: [prose("A sentence")], cursor: 1 }), request, publish: vi.fn(), status });
    checker.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(status).toHaveBeenLastCalledWith("error");
    checker.schedule();
    await vi.advanceTimersByTimeAsync(4_998);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(request).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenLastCalledWith("ready");
    checker.dispose();
  });

  it("waits for text composition and aborts only when disposed", async () => {
    let composing = true;
    const request = vi.fn<(batch: SpellcheckBatch, signal: AbortSignal) => Promise<SpellcheckResponseMatch[]>>(() => new Promise(() => {}));
    const checker = createSpellcheckController({ snapshot: () => ({ paragraphs: [prose("A sentence")], cursor: 1 }), composing: () => composing, request, publish: vi.fn(), status: vi.fn() });
    checker.start();
    await vi.advanceTimersByTimeAsync(400);
    expect(request).not.toHaveBeenCalled();
    composing = false;
    await vi.advanceTimersByTimeAsync(100);
    checker.dispose();
    expect(request.mock.calls[0][1].aborted).toBe(true);
  });

  it("finishes a document with more blocks than the historical cache limit", async () => {
    const request = vi.fn(async () => []);
    const status = vi.fn();
    const checker = createSpellcheckController({ snapshot: () => ({ paragraphs: Array.from({ length: 510 }, (_, i) => prose(`Paragraph ${i}`, i * 30)), cursor: 1 }), request, publish: vi.fn(), status });
    checker.start();
    await vi.advanceTimersByTimeAsync(250);
    const completedRequests = request.mock.calls.length;
    expect(status).toHaveBeenLastCalledWith("ready");
    checker.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(request).toHaveBeenCalledTimes(completedRequests);
    checker.dispose();
  });

  it("defers completed results until an active text composition ends", async () => {
    let composing = false;
    let finish!: (matches: SpellcheckResponseMatch[]) => void;
    const publish = vi.fn();
    const checker = createSpellcheckController({ snapshot: () => ({ paragraphs: [prose("Teh text")], cursor: 1 }), composing: () => composing,
      publish, status: vi.fn(), request: () => new Promise((resolve) => { finish = resolve; }),
    });
    checker.start();
    await vi.advanceTimersByTimeAsync(0);
    publish.mockClear();
    composing = true;
    finish([typo()]);
    await vi.advanceTimersByTimeAsync(500);
    expect(publish).not.toHaveBeenCalled();
    composing = false;
    await vi.advanceTimersByTimeAsync(250);
    expect(publish).toHaveBeenLastCalledWith([expect.objectContaining({ from: 1, to: 4 })]);
    checker.dispose();
  });
});
