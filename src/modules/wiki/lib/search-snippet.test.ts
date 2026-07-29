import { describe, expect, it } from "vitest";
import { parseSearchSnippet } from "./search-snippet";

describe("parseSearchSnippet", () => {
  it("retains FTS highlight ranges as presentation metadata", () => {
    expect(parseSearchSnippet("Before <mark>match</mark> after")).toEqual([
      { text: "Before ", highlighted: false },
      { text: "match", highlighted: true },
      { text: " after", highlighted: false },
    ]);
  });

  it("keeps arbitrary user-authored HTML as inert text", () => {
    expect(
      parseSearchSnippet('<img src=x onerror="alert(1)"> <mark>safe</mark>'),
    ).toEqual([
      {
        text: '<img src=x onerror="alert(1)"> ',
        highlighted: false,
      },
      { text: "safe", highlighted: true },
    ]);
  });

  it("handles unmatched markers without dropping snippet text", () => {
    expect(parseSearchSnippet("A <mark>partial")).toEqual([
      { text: "A ", highlighted: false },
      { text: "partial", highlighted: true },
    ]);
  });
});
