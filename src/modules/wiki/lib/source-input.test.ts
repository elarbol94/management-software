import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { graphicsSidecarSchema } from "./source-input";

/** The example Claude is pointed at must stay valid, so docs cannot drift from the schema. */
function documentedExample() {
  const doc = fs.readFileSync(path.join(process.cwd(), "docs/graphics-sidecar.md"), "utf8");
  const json = doc.split("```json")[1]?.split("```")[0];
  return JSON.parse(json ?? "");
}

describe("graphicsSidecarSchema", () => {
  it("accepts the documented example", () => {
    const parsed = graphicsSidecarSchema.parse(documentedExample());

    expect(parsed.title).toBe("Materieller Wohlstand in Österreich – Kennzahlen");
    expect(parsed.type).toBe("document");
    expect(parsed.contributors[0]).toMatchObject({ family: "Keuschnig", role: "author" });
    expect(parsed.caption).toContain("Abbildung X");
    expect(parsed.tagNames).toContain("eigene Darstellung");
  });

  it("fills in defaults so a minimal sidecar is enough", () => {
    const parsed = graphicsSidecarSchema.parse({ title: "Nur ein Titel", type: "document" });

    expect(parsed.readingStatus).toBe("toRead");
    expect(parsed.caption).toBe("");
    expect(parsed.contributors).toEqual([]);
    expect(parsed.tagNames).toEqual([]);
  });

  it("rejects a sidecar that targets an existing source or omits the title", () => {
    expect(() => graphicsSidecarSchema.parse({ type: "document" })).toThrow();
    expect(() => graphicsSidecarSchema.parse({ title: "X", type: "nonsense" })).toThrow();
    // `id` is stripped rather than honoured: a folder file may not overwrite an arbitrary source.
    expect(graphicsSidecarSchema.parse({ title: "X", type: "document", id: "abc" })).not.toHaveProperty("id");
  });
});
