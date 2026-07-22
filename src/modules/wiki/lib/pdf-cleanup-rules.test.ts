import { describe, expect, it } from "vitest";
import { pdfSourcePurgeBlocker } from "./pdf-evidence";

describe("PDF source purge rules", () => {
  it("blocks active page and generic evidence references", () => {
    expect(pdfSourcePurgeBlocker({ activePageReferences: 1, evidenceReferences: 0 })).toBe("active-pages");
    expect(pdfSourcePurgeBlocker({ activePageReferences: 0, evidenceReferences: 2 })).toBe("evidence");
  });

  it("allows an unreferenced source to be purged", () => {
    expect(pdfSourcePurgeBlocker({ activePageReferences: 0, evidenceReferences: 0 })).toBeNull();
  });
});
