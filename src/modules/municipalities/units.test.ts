import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYSIS_UNIT_IDS } from "./analysis";

// next-intl throws on a missing message, which takes the whole node list down with it —
// a unit without a label is a crash, not a cosmetic gap.
describe.each(["de", "en"])("%s unit labels", (locale) => {
  const messages = JSON.parse(readFileSync(resolve("messages", `${locale}.json`), "utf8")) as {
    municipalities: { units: Record<string, string> };
  };

  it("has a label for every analysis unit", () => {
    for (const id of ANALYSIS_UNIT_IDS) {
      expect(messages.municipalities.units[id], id).toBeTruthy();
    }
  });
});
