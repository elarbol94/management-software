import { describe, expect, it } from "vitest";
import { buildRevisionDiff, diffDocumentSettings } from "./revision-diff";

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

describe("diffDocumentSettings", () => {
  it("names each changed setting by path", () => {
    const before = JSON.stringify({ page: { size: "A4", margins: { top: 20 } }, bibliography: { enabled: true } });
    const after = JSON.stringify({ page: { size: "Letter", margins: { top: 25 } }, bibliography: { enabled: true } });
    expect(diffDocumentSettings(before, after)).toEqual([
      { path: "page.margins.top", from: "20", to: "25" },
      { path: "page.size", from: "A4", to: "Letter" },
    ]);
  });

  it("reports added and removed settings", () => {
    expect(diffDocumentSettings("{}", JSON.stringify({ cover: { enabled: true } })))
      .toEqual([{ path: "cover.enabled", from: "", to: "true" }]);
    expect(diffDocumentSettings(JSON.stringify({ cover: { enabled: true } }), "{}"))
      .toEqual([{ path: "cover.enabled", from: "true", to: "" }]);
  });

  it("compares arrays whole rather than per index", () => {
    const changes = diffDocumentSettings(JSON.stringify({ header: ["a", "b"] }), JSON.stringify({ header: ["a", "c"] }));
    expect(changes).toEqual([{ path: "header", from: '["a","b"]', to: '["a","c"]' }]);
  });

  it("returns nothing for identical or unparseable settings", () => {
    expect(diffDocumentSettings("", "")).toEqual([]);
    expect(diffDocumentSettings("not json", "not json")).toEqual([]);
    const same = JSON.stringify({ page: { size: "A4" } });
    expect(diffDocumentSettings(same, same)).toEqual([]);
  });
});
