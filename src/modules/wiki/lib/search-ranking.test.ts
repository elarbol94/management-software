import { describe, expect, it } from "vitest";
import { fuseRankings } from "./search-ranking";

type Hit = { id: string };
const key = (hit: Hit) => hit.id;
const list = (...ids: string[]) => ids.map((id) => ({ id }));

describe("fuseRankings", () => {
  it("interleaves lists instead of concatenating them", () => {
    const merged = fuseRankings([list("a1", "a2", "a3"), list("b1", "b2")], key);
    // Each list's leader outranks the other list's runner-up.
    expect(merged.map(key)).toEqual(["a1", "b1", "a2", "b2", "a3"]);
  });

  it("promotes an item that ranks well in more than one list", () => {
    const merged = fuseRankings([list("x", "shared"), list("y", "shared")], key);
    expect(merged[0]?.id).toBe("shared");
  });

  it("keeps a single list in its original order", () => {
    expect(fuseRankings([list("a", "b", "c")], key).map(key)).toEqual(["a", "b", "c"]);
  });

  it("breaks ties on the better original position, not insertion order", () => {
    // Both appear once at the same rank in different lists.
    const merged = fuseRankings([list("late", "early"), list("late", "early")], key);
    expect(merged.map(key)).toEqual(["late", "early"]);
  });

  it("handles empty input and empty lists", () => {
    expect(fuseRankings<Hit>([], key)).toEqual([]);
    expect(fuseRankings([[], list("only")], key).map(key)).toEqual(["only"]);
  });
});
