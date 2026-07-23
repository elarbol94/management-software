import { describe, expect, it } from "vitest";
import { focusScopeForPathname } from "./focus-mode";

describe("focus mode route scopes", () => {
  it("recognizes PDF reader routes", () => {
    expect(focusScopeForPathname("/wiki/sources/source-1/read/document-1")).toBe("pdf");
    expect(focusScopeForPathname("/wiki/sources/source-1/read/document-1/")).toBe("pdf");
  });

  it("recognizes note editor routes", () => {
    expect(focusScopeForPathname("/wiki/pages/project-notes")).toBe("note");
    expect(focusScopeForPathname("/wiki/pages/project-notes/")).toBe("note");
  });

  it("does not focus surrounding workspace routes", () => {
    expect(focusScopeForPathname("/wiki/inbox")).toBeNull();
    expect(focusScopeForPathname("/wiki/pages")).toBeNull();
    expect(focusScopeForPathname("/wiki/sources/source-1")).toBeNull();
    expect(focusScopeForPathname("/projects/project-1")).toBeNull();
  });
});
