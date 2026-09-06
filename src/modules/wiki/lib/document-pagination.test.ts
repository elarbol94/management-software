import { describe, expect, it } from "vitest";
import {
  computeDocumentPagination,
  type PaginationGeometry,
  type PaginationItem,
  type PaginationSplit,
} from "./document-pagination";

// Page 0 holds content between 100 and 900, page 1 between 1200 and 2000.
const geometry: PaginationGeometry = { pageHeight: 1000, pageGap: 100, marginTop: 100, marginBottom: 100 };

function lines(top: number, count: number, height = 200, position = 100): PaginationSplit[] {
  return Array.from({ length: count }, (_, index) => ({
    position: position + index,
    top: top + index * height,
    bottom: top + (index + 1) * height,
  }));
}

function block(item: Partial<PaginationItem> & Pick<PaginationItem, "top" | "bottom">): PaginationItem {
  return { position: 0, ...item };
}

describe("computeDocumentPagination", () => {
  it("keeps a legacy figure list on a new page without adding an empty first page", () => {
    const list = block({ position: 10, top: 400, bottom: 700, breakBefore: true });
    expect(computeDocumentPagination([block({ top: 100, bottom: 400 }), list], geometry).breaks).toEqual([{ position: 10, height: 800, page: 2, kind: "block" }]);
    expect(computeDocumentPagination([{ ...list, top: 100, bottom: 400 }], geometry).breaks).toEqual([]);
  });
  it("moves a whole block that would cross the page edge", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 800 }),
      block({ position: 10, top: 800, bottom: 1000 }),
    ], geometry);
    expect(plan.breaks).toEqual([{ position: 10, height: 400, page: 2, kind: "block" }]);
    expect(plan.pageCount).toBe(2);
  });

  it("leaves a block taller than a page where it is", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 400 }),
      block({ position: 10, top: 400, bottom: 1600 }),
    ], geometry);
    expect(plan.breaks).toEqual([]);
  });

  it("splits a long paragraph at the first overflowing line", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 1300, splittable: true, splits: lines(100, 6) }),
    ], geometry);
    expect(plan.breaks).toEqual([{ position: 104, height: 300, page: 2, kind: "inline" }]);
    expect(plan.pageCount).toBe(2);
  });

  it("splits a paragraph across several pages", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 2900, splittable: true, splits: lines(100, 14) }),
    ], geometry);
    expect(plan.breaks.map((item) => item.page)).toEqual([2, 3, 4]);
    expect(plan.breaks.every((item) => item.kind === "inline")).toBe(true);
    expect(plan.pageCount).toBe(4);
  });

  it("splits tables at row boundaries with a row spacer", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 1300, splittable: true, splitKind: "tableRow", splits: lines(100, 6) }),
    ], geometry);
    expect(plan.breaks).toEqual([{ position: 104, height: 300, page: 2, kind: "tableRow" }]);
  });

  it("never splits a keepTogether block", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 500 }),
      block({ position: 10, top: 500, bottom: 1100, keepTogether: true, splittable: true, splits: lines(500, 3) }),
    ], geometry);
    expect(plan.breaks).toEqual([{ position: 10, height: 700, page: 2, kind: "block" }]);
  });

  it("keeps at least two lines on each side of a split", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 800 }),
      block({ position: 10, top: 800, bottom: 1400, splittable: true, splits: lines(800, 3) }),
    ], geometry);
    expect(plan.breaks).toEqual([{ position: 10, height: 400, page: 2, kind: "block" }]);
  });

  it("moves a keepWithNext block together with the block after it", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 700 }),
      block({ position: 10, top: 700, bottom: 800, keepWithNext: true }),
      block({ position: 20, top: 800, bottom: 1600, splittable: true, splits: lines(800, 4) }),
    ], geometry);
    expect(plan.breaks).toEqual([{ position: 10, height: 500, page: 2, kind: "block" }]);
  });

  it("does not leave a lone heading at the bottom of a page", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 700 }),
      block({ position: 10, top: 700, bottom: 800, heading: true }),
      block({ position: 20, top: 800, bottom: 1600, splittable: true, splits: lines(800, 4) }),
    ], geometry);
    expect(plan.breaks).toEqual([{ position: 10, height: 500, page: 2, kind: "block" }]);
  });

  it("keeps a heading in place when the next block can never share its page", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 700 }),
      block({ position: 10, top: 700, bottom: 800, heading: true }),
      block({ position: 20, top: 800, bottom: 2400 }),
    ], geometry);
    expect(plan.breaks).toEqual([]);
  });

  it("reports splittable blocks whose line geometry is still unmeasured", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 1300, splittable: true }),
    ], geometry);
    expect(plan.measure).toEqual([0]);
    expect(plan.breaks).toEqual([]);
  });

  it("reports the block a heading needs to be measured against", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 800, heading: true }),
      block({ position: 10, top: 800, bottom: 1000, splittable: true }),
    ], geometry);
    expect(plan.measure).toContain(1);
  });

  it("asks for no line geometry while everything fits on the page", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 300, heading: true }),
      block({ position: 10, top: 300, bottom: 700, splittable: true }),
      block({ position: 20, top: 700, bottom: 900, splittable: true }),
    ], geometry);
    expect(plan).toEqual({ breaks: [], pageCount: 1, measure: [] });
  });

  it("starts the block after an explicit page break on a new page", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 200 }),
      block({ position: 5, top: 200, bottom: 200, pageBreak: true }),
      block({ position: 10, top: 200, bottom: 300 }),
    ], geometry);
    expect(plan.breaks).toEqual([{ position: 10, height: 1000, page: 2, kind: "block" }]);
    expect(plan.pageCount).toBe(2);
  });

  it("pulls a block that starts inside the top margin into the content area", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 40, bottom: 300 }),
    ], geometry);
    expect(plan.breaks).toEqual([{ position: 0, height: 60, page: 2, kind: "block" }]);
  });

  it("uses the list item spacer for list children", () => {
    const plan = computeDocumentPagination([
      block({ position: 0, top: 100, bottom: 850 }),
      block({ position: 10, top: 850, bottom: 1000, kind: "listItem" }),
    ], geometry);
    expect(plan.breaks[0].kind).toBe("listItem");
  });

  it("keeps a short document on a single page", () => {
    const plan = computeDocumentPagination([block({ position: 0, top: 100, bottom: 400 })], geometry);
    expect(plan).toEqual({ breaks: [], pageCount: 1, measure: [] });
  });
});
