import { Cite } from "@citation-js/core";
import "@citation-js/plugin-csl";
import {
  LOCATOR_PLACEHOLDER,
  formatBibliographyEntry,
  isNumericCitationStyle,
  toCslJson,
  type CitationSource,
  type CitationStyle,
} from "./citations";

/** Locators citeproc will never emit on its own, so the rendered output can be split around them. */
const LOCATOR_PROBE = "9182736450";

export function formatIeeeBibliography(source: CitationSource, locale = "en-US") {
  try {
    // Validate and normalize the source through Citation.js' CSL pipeline,
    // then render the IEEE-specific punctuation used by the editor and exports.
    new Cite([toCslJson(source)]);
    return formatBibliographyEntry({ ...source, renderedBibliography: undefined }, locale);
  } catch {
    return "";
  }
}

/**
 * Renders one source through a real CSL style. Returns empty strings when the style
 * is IEEE (hand-rolled elsewhere) or when citeproc rejects the record, so callers
 * always fall back to the previous output rather than showing nothing.
 */
function renderCsl(source: CitationSource, style: CitationStyle, locale: string) {
  const empty = { bibliography: "", inline: "", inlineTemplate: "" };
  if (style === "ieee") return empty;
  try {
    const cite = new Cite([toCslJson(source)]);
    // Numeric styles number the entry themselves, and because each source is rendered
    // alone that number is always "1." — the document's own ordering supplies it instead.
    const bibliography = cite
      .format("bibliography", { template: style, lang: locale })
      .trim()
      .replace(/^\d+\.\s*/, "");
    const inline = cite.format("citation", { template: style, lang: locale }).trim();
    // `entry` drives citeproc's locator handling but is missing from the package's types.
    const probeOptions = { template: style, lang: locale, entry: [{ id: source.id, locator: LOCATOR_PROBE, label: "page" }] } as Parameters<typeof cite.format>[1];
    const probed = cite.format("citation", probeOptions).trim();
    // The probe only yields a template when citeproc actually placed the locator.
    const inlineTemplate = probed.includes(LOCATOR_PROBE)
      ? probed.replace(LOCATOR_PROBE, LOCATOR_PLACEHOLDER)
      : "";
    return { bibliography, inline, inlineTemplate };
  } catch {
    return empty;
  }
}

export function decorateCitationSource(
  source: CitationSource,
  locale = "en-US",
  style: CitationStyle = "ieee",
): CitationSource {
  if (style === "ieee") {
    return { ...source, renderedBibliography: formatIeeeBibliography(source, locale) || undefined };
  }
  const rendered = renderCsl(source, style, locale);
  const decorated: CitationSource = {
    ...source,
    renderedBibliography:
      rendered.bibliography || formatIeeeBibliography(source, locale) || undefined,
  };
  // Numeric styles are numbered by order of appearance in the document, which citeproc
  // cannot see from a single source, so their in-text label stays app-generated.
  if (!isNumericCitationStyle(style)) {
    decorated.renderedInline = rendered.inline || undefined;
    decorated.renderedInlineTemplate = rendered.inlineTemplate || undefined;
  }
  return decorated;
}
