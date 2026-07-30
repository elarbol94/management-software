/**
 * Figure numbering shared by the on-screen document and the export.
 *
 * A caption may already carry its own number — the graphics sidecars written for
 * the Projektbeschreibung start with "Abbildung 4: …" so the wording is fixed in
 * the source of truth. Numbering such a caption again produced "Figure 1.
 * Abbildung 4: …", so a caption that numbers itself keeps that number and the
 * document adds none.
 */

/** "Abbildung 4:", "Figure 12.", "Fig. 3 —" and the like, at the very start. */
const OWN_FIGURE_NUMBER = /^\s*(?:abbildung|abb\.|figure|fig\.)\s*\d+\s*[.:—–-]/i;

export function hasOwnFigureNumber(caption: string) {
  return OWN_FIGURE_NUMBER.test(caption);
}

/** The label a document puts in front of a caption, empty when the caption numbers itself. */
export function figureNumberLabel(caption: string, label: string, number: number) {
  return hasOwnFigureNumber(caption) ? "" : `${label} ${number}`;
}
