import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpellcheckController } from "./spellcheck-controller";
import type { SpellcheckBatch, SpellcheckResponseMatch } from "./spellcheck";

const typo = (paragraph = 0): SpellcheckResponseMatch => ({ paragraph, offset: 0, length: 3, message: "Typo", kind: "spelling", category: "Spelling", ruleId: "TYPO", replacements: ["The"] });
const prose = (text: string, from = 1) => ({ text, from, excludedRanges: [] });

describe("incremental proofing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

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
    await vi.advanceTimersByTimeAsync(50);
    expect(request).toHaveBeenCalledTimes(8);
    expect(status).toHaveBeenLastCalledWith("ready");
    checker.schedule();
    await vi.advanceTimersByTimeAsync(300);
    expect(request).toHaveBeenCalledTimes(8);
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
