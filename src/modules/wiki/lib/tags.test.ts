import { describe, expect, it } from "vitest";
import { parseTagList } from "./tags";
import { buildPageTree } from "./page-tree";

describe("parseTagList", () => {
  it("splits group_concat pairs into ids and names", () => {
    expect(parseTagList("t1:Österreich,t2:Stadt-Land")).toEqual([
      { id: "t1", name: "Österreich" },
      { id: "t2", name: "Stadt-Land" },
    ]);
  });

  it("keeps names that contain a colon", () => {
    expect(parseTagList("t1:Studie: 2026")).toEqual([{ id: "t1", name: "Studie: 2026" }]);
  });

  it("returns nothing for empty or malformed input", () => {
    expect(parseTagList(null)).toEqual([]);
    expect(parseTagList("")).toEqual([]);
    expect(parseTagList("nocolon")).toEqual([]);
  });
});

describe("buildPageTree", () => {
  const page = (id: string, parentId: string | null, sortOrder = 0, createdAt = 0) => ({ id, parentId, sortOrder, createdAt });

  it("nests children under their parent and records depth", () => {
    const rows = buildPageTree([page("child", "root"), page("root", null), page("grandchild", "child")]);
    expect(rows.map((row) => [row.id, row.depth])).toEqual([["root", 0], ["child", 1], ["grandchild", 2]]);
  });

  it("orders siblings by sortOrder then createdAt", () => {
    const rows = buildPageTree([page("c", null, 1, 5), page("a", null, 0, 9), page("b", null, 1, 2)]);
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps orphans instead of dropping them", () => {
    const rows = buildPageTree([page("orphan", "deleted-parent"), page("root", null)]);
    expect(rows.map((row) => [row.id, row.depth]).sort()).toEqual([["orphan", 0], ["root", 0]]);
  });
});
