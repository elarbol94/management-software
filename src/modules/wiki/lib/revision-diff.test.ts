import { describe, expect, it } from "vitest";
import { buildRevisionDiff } from "./revision-diff";

describe("buildRevisionDiff", () => {
  it("keeps identical lines aligned and numbered", () => {
    const rows = buildRevisionDiff("one\ntwo", "one\ntwo");
    expect(rows.map((row) => [row.old.lineNumber, row.current.lineNumber, row.old.kind])).toEqual([
      [1, 1, "unchanged"],
      [2, 2, "unchanged"],
    ]);
  });

  it("aligns inserted and deleted lines with empty counterparts", () => {
    const inserted = buildRevisionDiff("one\ntwo", "one\nnew\ntwo");
    expect(inserted[1]).toMatchObject({
      old: { lineNumber: null, kind: "empty" },
      current: { lineNumber: 2, kind: "added", text: "new" },
    });

    const deleted = buildRevisionDiff("one\nold\ntwo", "one\ntwo");
    expect(deleted[1]).toMatchObject({
      old: { lineNumber: 2, kind: "removed", text: "old" },
      current: { lineNumber: null, kind: "empty" },
    });
  });

  it("pairs replacements and highlights changed words", () => {
    const [row] = buildRevisionDiff("hello old world", "hello new world");
    expect(row.old.kind).toBe("removed");
    expect(row.current.kind).toBe("added");
    expect(row.old.parts.find((part) => part.changed)?.text).toBe("old");
    expect(row.current.parts.find((part) => part.changed)?.text).toBe("new");
  });

  it("retains empty lines", () => {
    const rows = buildRevisionDiff("one\n\ntwo", "one\n\ntwo");
    expect(rows).toHaveLength(3);
    expect(rows[1].old.text).toBe("");
  });
});
