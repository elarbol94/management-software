import { describe, expect, it } from "vitest";
import {
  DEFAULT_WIKI_PROOFING_PREFS,
  normalizeWikiProofingPrefs,
  parseWikiProofingPrefs,
  serializeWikiProofingPrefs,
  withDisabledRuleId,
  withIgnoredIssueKey,
} from "./wiki-proofing-prefs";

describe("wiki proofing preferences", () => {
  it("defaults to picky off with empty lists for missing or invalid input", () => {
    expect(normalizeWikiProofingPrefs(undefined)).toEqual(DEFAULT_WIKI_PROOFING_PREFS);
    expect(normalizeWikiProofingPrefs(null)).toEqual(DEFAULT_WIKI_PROOFING_PREFS);
    expect(normalizeWikiProofingPrefs("not an object")).toEqual(DEFAULT_WIKI_PROOFING_PREFS);
    expect(parseWikiProofingPrefs(undefined)).toEqual(DEFAULT_WIKI_PROOFING_PREFS);
    expect(parseWikiProofingPrefs("")).toEqual(DEFAULT_WIKI_PROOFING_PREFS);
    expect(parseWikiProofingPrefs("not json")).toEqual(DEFAULT_WIKI_PROOFING_PREFS);
  });

  it("round-trips picky mode and both lists through serialize/parse", () => {
    const prefs = normalizeWikiProofingPrefs({ picky: true, ignoredIssueKeys: ["a", "b"], disabledRuleIds: ["RULE_X"] });
    expect(parseWikiProofingPrefs(serializeWikiProofingPrefs(prefs))).toEqual(prefs);
  });

  it("drops non-string, empty, or oversized list entries and de-dupes", () => {
    const prefs = normalizeWikiProofingPrefs({
      ignoredIssueKeys: ["a", "a", "", 42, "b"],
      disabledRuleIds: ["RULE", "RULE", null],
    });
    expect(prefs.ignoredIssueKeys).toEqual(["a", "b"]);
    expect(prefs.disabledRuleIds).toEqual(["RULE"]);
  });

  it("appends via the with* helpers without duplicating existing entries", () => {
    const prefs = withIgnoredIssueKey(DEFAULT_WIKI_PROOFING_PREFS, "key-1");
    expect(prefs.ignoredIssueKeys).toEqual(["key-1"]);
    expect(withIgnoredIssueKey(prefs, "key-1").ignoredIssueKeys).toEqual(["key-1"]);

    const withRule = withDisabledRuleId(DEFAULT_WIKI_PROOFING_PREFS, "RULE_A");
    expect(withRule.disabledRuleIds).toEqual(["RULE_A"]);
  });
});
