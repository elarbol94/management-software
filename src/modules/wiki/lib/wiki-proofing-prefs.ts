export const WIKI_PROOFING_PREFS_VERSION = 1 as const;

export type WikiProofingPrefsV1 = {
  version: typeof WIKI_PROOFING_PREFS_VERSION;
  picky: boolean;
  ignoredIssueKeys: string[];
  disabledRuleIds: string[];
};

export const DEFAULT_WIKI_PROOFING_PREFS: WikiProofingPrefsV1 = {
  version: WIKI_PROOFING_PREFS_VERSION,
  picky: false,
  ignoredIssueKeys: [],
  disabledRuleIds: [],
};

const MAX_IGNORED_ISSUE_KEYS = 500;
const MAX_DISABLED_RULE_IDS = 200;

function stringSet(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const deduped = [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 500))];
  // Keep the most recently added entries when trimming to the cap.
  return deduped.slice(-max);
}

export function normalizeWikiProofingPrefs(value: unknown): WikiProofingPrefsV1 {
  const input = value && typeof value === "object" ? value as Partial<WikiProofingPrefsV1> : {};
  return {
    version: WIKI_PROOFING_PREFS_VERSION,
    picky: input.picky === true,
    ignoredIssueKeys: stringSet(input.ignoredIssueKeys, MAX_IGNORED_ISSUE_KEYS),
    disabledRuleIds: stringSet(input.disabledRuleIds, MAX_DISABLED_RULE_IDS),
  };
}

export function parseWikiProofingPrefs(raw: string | null | undefined): WikiProofingPrefsV1 {
  if (!raw?.trim()) return DEFAULT_WIKI_PROOFING_PREFS;
  try {
    return normalizeWikiProofingPrefs(JSON.parse(raw));
  } catch {
    return DEFAULT_WIKI_PROOFING_PREFS;
  }
}

export function serializeWikiProofingPrefs(prefs: WikiProofingPrefsV1): string {
  return JSON.stringify(normalizeWikiProofingPrefs(prefs));
}

export function withIgnoredIssueKey(prefs: WikiProofingPrefsV1, key: string): WikiProofingPrefsV1 {
  return normalizeWikiProofingPrefs({ ...prefs, ignoredIssueKeys: [...prefs.ignoredIssueKeys, key] });
}

export function withDisabledRuleId(prefs: WikiProofingPrefsV1, ruleId: string): WikiProofingPrefsV1 {
  return normalizeWikiProofingPrefs({ ...prefs, disabledRuleIds: [...prefs.disabledRuleIds, ruleId] });
}
