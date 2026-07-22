import { describe, expect, it } from "vitest";
import { parseByteRange } from "./http-range";

describe("HTTP byte ranges", () => {
  it("parses bounded and suffix byte ranges", () => {
    expect(parseByteRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=1000-1001", 1000)).toBeNull();
  });
});
