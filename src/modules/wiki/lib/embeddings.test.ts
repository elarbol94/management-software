import { describe, expect, it } from "vitest";
import { chunkText, isMeaningfulChunk } from "./chunking";

describe("chunkText", () => {
  it("returns nothing for empty or whitespace-only text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\t ")).toEqual([]);
  });

  it("keeps short text as a single chunk and collapses whitespace", () => {
    expect(chunkText("Die   Gemeinde\n\nerhöht  die Gebühren.")).toEqual(["Die Gemeinde erhöht die Gebühren."]);
  });

  it("splits long text into overlapping chunks that cover everything", () => {
    const sentence = "Der Gemeinderat beschloss eine Erhöhung der Gebühren. ";
    const text = sentence.repeat(60);
    const chunks = chunkText(text, 400, 80);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(400);
    // Overlap means consecutive chunks share text, so nothing falls between them.
    expect(chunks[0].slice(-40).length).toBe(40);
    const rejoined = chunks.join(" ");
    expect(rejoined).toContain("Der Gemeinderat beschloss");
  });

  it("prefers sentence boundaries so chunks read as prose", () => {
    const text = `${"a".repeat(300)}. ${"b".repeat(300)}. ${"c".repeat(300)}.`;
    const chunks = chunkText(text, 400, 50);
    // The first chunk should stop at the sentence break, not mid-run.
    expect(chunks[0].endsWith(".")).toBe(true);
  });

  it("always terminates, even when no boundary is available", () => {
    const chunks = chunkText("x".repeat(5000), 200, 50);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("").length).toBeGreaterThanOrEqual(5000 - chunks.length * 50);
  });
});

describe("isMeaningfulChunk", () => {
  it("rejects the fragments PDF extraction produces", () => {
    // Real examples seen in an indexed corpus.
    expect(isMeaningfulChunk("/")).toBe(false);
    expect(isMeaningfulChunk("  42  ")).toBe(false);
    expect(isMeaningfulChunk("- 17 -")).toBe(false);
    expect(isMeaningfulChunk("....................")).toBe(false);
  });

  it("keeps real prose", () => {
    expect(isMeaningfulChunk("Die Gemeinde erhöht die Gebühren ab 2025.")).toBe(true);
    expect(isMeaningfulChunk("The council approved the budget.")).toBe(true);
  });

  it("keeps chunkText from emitting junk", () => {
    expect(chunkText("/")).toEqual([]);
    expect(chunkText("- 17 -")).toEqual([]);
  });
});
