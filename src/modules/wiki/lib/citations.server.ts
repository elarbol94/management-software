import { Cite } from "@citation-js/core";
import "@citation-js/plugin-csl";
import { formatBibliographyEntry, toCslJson, type CitationSource } from "./citations";

export function formatIeeeBibliography(source: CitationSource, locale = "en-US") {
  try {
    // Validate and normalize the source through Citation.js' CSL pipeline,
    // then render the IEEE-specific punctuation used by the editor and exports.
    new Cite([toCslJson(source)]);
    return formatBibliographyEntry({ ...source, ieeeBibliography: undefined }, locale);
  } catch {
    return "";
  }
}

export function decorateCitationSource(source: CitationSource, locale = "en-US"): CitationSource {
  return { ...source, ieeeBibliography: formatIeeeBibliography(source, locale) || undefined };
}
