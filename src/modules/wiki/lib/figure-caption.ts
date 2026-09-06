/** Figure labels are sequential; legacy table captions retain their own numbering. */

/** "Abbildung 4:", "Figure 12.", "Fig. 3 —" and the like, at the very start. */
const OWN_FIGURE_NUMBER = /^\s*(?:abbildung|abb\.|figure|fig\.)\s*\d+\s*[.:—–-]/i;
/** Same shape, capturing the caption's own word ("Abbildung"/"Fig.") and number. */
const OWN_FIGURE_NUMBER_CAPTURE = /^\s*(abbildung|abb\.|figure|fig\.)\s*(\d+)\s*[.:—–-]/i;

export function hasOwnFigureNumber(caption: string) {
  return OWN_FIGURE_NUMBER.test(caption);
}

/** The number embedded in a caption that already numbers itself, else null. */
export function ownFigureNumber(caption: string): number | null {
  const match = caption.match(OWN_FIGURE_NUMBER_CAPTURE);
  return match ? Number(match[2]) : null;
}

/** The sequential label a document puts in front of a normalized figure caption. */
export function figureNumberLabel(_caption: string, label: string, number: number) {
  return `${label} ${number}`;
}

/** The number a reference to this item should show: its own embedded number if it has one, else its position in document order. */
export function referenceNumber(caption: string, sequentialNumber: number): number {
  return ownFigureNumber(caption) ?? sequentialNumber;
}

/**
 * The label a *reference* to this item should show — unlike `figureNumberLabel`
 * (which goes blank for a self-numbered caption, since the caption already carries
 * a number), a reference always needs to show one. A self-numbered caption echoes
 * back its own wording ("Abb. 2"); otherwise it gets the already-formatted
 * sequential label ("Figure 3", "Abbildung 3", …) the caller computed.
 */
export function referenceLabel(caption: string, sequentialLabel: string): string {
  const match = caption.match(OWN_FIGURE_NUMBER_CAPTURE);
  return match ? `${match[1]} ${match[2]}` : sequentialLabel;
}

export type CrossReferenceSources = {
  headings: Array<{ id: string; text: string }>;
  annexes: Array<{ id: string; title: string }>;
  figures: Array<{ id: string; caption: string }>;
  tables: Array<{ id: string; caption: string }>;
  figureLabel: string;
  tableLabel: string;
};

/**
 * The live label a cross-reference to each target should show, keyed by target
 * id. Shared by the editor canvas and every export so a reference always reads
 * the same number as the figure/table/heading it points at, in document order.
 */
export function resolveCrossReferenceLabels(sources: CrossReferenceSources): Map<string, string> {
  const labels = new Map<string, string>();
  for (const heading of sources.headings) if (heading.id) labels.set(heading.id, heading.text);
  for (const annex of sources.annexes) if (annex.id) labels.set(annex.id, annex.title);
  sources.figures.forEach((figure, index) => {
    if (!figure.id) return;
    labels.set(figure.id, `${sources.figureLabel} ${index + 1}`);
  });
  sources.tables.forEach((table, index) => {
    if (!table.id) return;
    labels.set(table.id, referenceLabel(table.caption, `${sources.tableLabel} ${index + 1}`));
  });
  return labels;
}
