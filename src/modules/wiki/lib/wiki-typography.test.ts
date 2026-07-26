import { describe, expect, it } from "vitest";
import {
  DEFAULT_WIKI_TYPOGRAPHY,
  WIKI_TYPOGRAPHY_DENSITY_PRESETS,
  applyWikiTypographyDensity,
  normalizeWikiTypography,
  parseWikiTypography,
  wikiTypographyCssVariables,
} from "./wiki-typography";

describe("wiki typography", () => {
  it("uses compact list spacing by default", () => {
    expect(parseWikiTypography("")).toMatchObject({
      density: "standard",
      lineHeight: 1.5,
      paragraphSpacingEm: 0.65,
      listItemSpacingEm: 0.15,
      listBlockSpacingEm: 0.65,
      listIndentEm: 1.75,
    });
  });

  it("recovers damaged values and clamps numeric settings", () => {
    expect(parseWikiTypography("{damaged")).toEqual(DEFAULT_WIKI_TYPOGRAPHY);
    expect(normalizeWikiTypography({
      bodySizePt: 100,
      lineHeight: 0,
      paragraphSpacingEm: -2,
      listItemSpacingEm: 99,
      listIndentEm: 0,
      textColor: "red",
    })).toMatchObject({
      bodySizePt: 16,
      lineHeight: 1.1,
      paragraphSpacingEm: 0,
      listItemSpacingEm: 1.25,
      listIndentEm: 1,
      textColor: DEFAULT_WIKI_TYPOGRAPHY.textColor,
    });
  });

  it("clamps every adjustable numeric field to its supported range", () => {
    expect(normalizeWikiTypography({
      bodySizePt: 1,
      lineHeight: 9,
      paragraphSpacingEm: 9,
      listItemSpacingEm: -1,
      listBlockSpacingEm: 9,
      listIndentEm: 9,
      h1SizeEm: 9,
      h2SizeEm: 0,
      h3SizeEm: 9,
      headingLineHeight: 0,
      headingSpacingBeforeEm: 9,
      headingSpacingAfterEm: -1,
    })).toMatchObject({
      bodySizePt: 8,
      lineHeight: 2,
      paragraphSpacingEm: 2,
      listItemSpacingEm: 0,
      listBlockSpacingEm: 2,
      listIndentEm: 4,
      h1SizeEm: 3.5,
      h2SizeEm: 1.2,
      h3SizeEm: 2,
      headingLineHeight: 1,
      headingSpacingBeforeEm: 3,
      headingSpacingAfterEm: 0,
    });
  });

  it.each(["compact", "standard", "spacious"] as const)("applies the %s density preset", (density) => {
    expect(applyWikiTypographyDensity(DEFAULT_WIKI_TYPOGRAPHY, density)).toMatchObject({
      density,
      ...WIKI_TYPOGRAPHY_DENSITY_PRESETS[density],
    });
  });

  it("creates editor CSS variables from normalized settings", () => {
    expect(wikiTypographyCssVariables(DEFAULT_WIKI_TYPOGRAPHY)).toMatchObject({
      "--wiki-line-height": "1.5",
      "--wiki-list-item-spacing": "0.15em",
      "--wiki-list-indent": "1.75em",
      "--wiki-text-color": "#172033",
    });
  });
});
