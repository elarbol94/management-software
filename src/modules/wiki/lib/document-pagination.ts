// Pure page-break arithmetic for the on-screen document view. The editor measures
// geometry in the DOM and this module decides where spacers go, so the decision
// logic stays testable without a browser.

export type DocumentPaginationBreakKind = "block" | "listItem" | "inline" | "tableRow";

export type DocumentPaginationBreak = {
  position: number;
  height: number;
  page: number;
  kind?: DocumentPaginationBreakKind;
};

/** A line box, table row or code line the block may be split before. */
export type PaginationSplit = {
  /** ProseMirror position the break spacer is inserted at. */
  position: number;
  top: number;
  bottom: number;
};

export type PaginationItem = {
  /** ProseMirror position for a break placed before the whole block. */
  position: number;
  top: number;
  bottom: number;
  kind?: "block" | "listItem";
  /** Widget kind used for breaks placed inside the block. */
  splitKind?: "inline" | "tableRow";
  /** True when the block could be split; `splits` may still be unmeasured. */
  splittable?: boolean;
  /** Measured split candidates in flow order, starting with the block's first line. */
  splits?: PaginationSplit[];
  pageBreak?: boolean;
  heading?: boolean;
  keepWithNext?: boolean;
  keepTogether?: boolean;
};

export type PaginationGeometry = {
  pageHeight: number;
  pageGap: number;
  marginTop: number;
  marginBottom: number;
};

export type PaginationPlan = {
  breaks: DocumentPaginationBreak[];
  pageCount: number;
  /** Item indices whose split geometry is needed but was not measured yet. */
  measure: number[];
};

/** Sub-pixel slack so a block resting exactly on the margin is not pushed down. */
const TOLERANCE = 1;
/** Widow/orphan control: never leave fewer than this many lines or rows behind. */
const MIN_KEEP_UNITS = 2;
/** How far a keepWithNext (or heading) chain is followed before giving up. */
const KEEP_CHAIN_LOOKAHEAD = 3;

function splitPoints(item: PaginationItem): PaginationSplit[] {
  if (item.keepTogether || !item.splits) return [];
  const total = item.splits.length;
  return item.splits.filter((_, index) => index >= MIN_KEEP_UNITS && total - index >= MIN_KEEP_UNITS);
}

/** Bottom of the part of a block that can never be separated from its start. */
function retainedBottom(item: PaginationItem) {
  if (!splitPoints(item).length) return item.bottom;
  return item.splits![MIN_KEEP_UNITS - 1].bottom;
}

export function computeDocumentPagination(
  items: PaginationItem[],
  geometry: PaginationGeometry,
): PaginationPlan {
  const cycle = geometry.pageHeight + geometry.pageGap;
  const usableHeight = geometry.pageHeight - geometry.marginTop - geometry.marginBottom;
  const pageOf = (top: number) => Math.max(0, Math.floor(top / cycle));
  const contentStartOf = (page: number) => page * cycle + geometry.marginTop;
  const contentEndOf = (page: number) => page * cycle + geometry.pageHeight - geometry.marginBottom;

  const breaks: DocumentPaginationBreak[] = [];
  const measure = new Set<number>();
  let accumulated = 0;
  let forceNextPage = false;
  let finalBottom = geometry.marginTop;

  // A heading (or an explicit keepWithNext block) must stay with the first lines
  // of what follows it, so placement looks at the chain rather than the block.
  const chainBottom = (index: number) => {
    let bottom = retainedBottom(items[index]);
    let cursor = index;
    for (let step = 0; step < KEEP_CHAIN_LOOKAHEAD; step += 1) {
      const current = items[cursor];
      const next = items[cursor + 1];
      if (!next || next.pageBreak) break;
      if (!current.keepWithNext && !current.heading) break;
      if (next.splittable && !next.splits) measure.add(cursor + 1);
      const nextBottom = retainedBottom(next);
      // Moving the chain onto a fresh page only helps if the chain fits there.
      if (nextBottom - items[index].top > usableHeight) break;
      bottom = Math.max(bottom, nextBottom);
      cursor += 1;
    }
    return bottom;
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.pageBreak) {
      forceNextPage = true;
      continue;
    }

    let flowTop = item.top + accumulated;
    const page = pageOf(flowTop);
    const contentStart = contentStartOf(page);
    const contentEnd = contentEndOf(page);
    const height = item.bottom - item.top;
    const points = splitPoints(item);
    let offset = 0;

    if (forceNextPage) {
      forceNextPage = false;
      offset = contentStartOf(page + 1) - flowTop;
    } else if (flowTop < contentStart) {
      offset = contentStart - flowTop;
    } else if (chainBottom(index) + accumulated > contentEnd + TOLERANCE) {
      // An unsplittable block taller than a page can never be placed; moving it
      // would only leave an empty page behind it.
      if (points.length || height <= usableHeight) offset = contentStartOf(page + 1) - flowTop;
    }

    if (offset > 0.5) {
      breaks.push({
        position: item.position,
        height: offset,
        page: Math.max(1, pageOf(flowTop + offset)) + 1,
        kind: item.kind ?? "block",
      });
      accumulated += offset;
      flowTop += offset;
    }

    if (item.splittable && !item.splits && !item.keepTogether && item.bottom + accumulated > contentEndOf(pageOf(flowTop)) + TOLERANCE) {
      measure.add(index);
    }

    for (const split of points) {
      const splitTop = split.top + accumulated;
      const splitPage = pageOf(splitTop);
      if (split.bottom + accumulated <= contentEndOf(splitPage) + TOLERANCE) continue;
      const splitOffset = contentStartOf(splitPage + 1) - splitTop;
      if (splitOffset <= TOLERANCE) continue;
      breaks.push({
        position: split.position,
        height: splitOffset,
        page: Math.max(1, pageOf(splitTop + splitOffset)) + 1,
        kind: item.splitKind ?? "inline",
      });
      accumulated += splitOffset;
    }

    finalBottom = Math.max(finalBottom, item.bottom + accumulated);
  }

  return {
    breaks,
    pageCount: Math.max(1, Math.floor((finalBottom + geometry.marginBottom) / cycle) + 1),
    measure: [...measure],
  };
}
