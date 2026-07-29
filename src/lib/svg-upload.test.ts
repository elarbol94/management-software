import { describe, expect, it } from "vitest";
import { isSafeInlineSvg } from "./svg-upload";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("SVG upload validation", () => {
  it("accepts self-contained vector artwork", () => {
    expect(isSafeInlineSvg(bytes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M0 0h20v20H0z" fill="#315efb"/></svg>'))).toBe(true);
  });

  it("rejects active markup and remote resources", () => {
    expect(isSafeInlineSvg(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBe(false);
    expect(isSafeInlineSvg(bytes('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/pixel.png"/></svg>'))).toBe(false);
    expect(isSafeInlineSvg(bytes('<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)"/></svg>'))).toBe(false);
  });
});
