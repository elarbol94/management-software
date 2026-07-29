import { describe, expect, it } from "vitest";
import {
  applyDocumentTypography,
  contentWidthMm,
  diagramDisplayWidthPx,
  dominantFontSize,
  parseFontSize,
  parseViewBox,
  readStyleProperty,
  type SvgElement,
  writeStyleProperty,
} from "./svg-typography";
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettingsV1 } from "./document-settings";

function node(attributes: Record<string, string> = {}) {
  const values = { ...attributes };
  return {
    values,
    getAttribute: (name: string) => values[name] ?? null,
    setAttribute: (name: string, value: string) => { values[name] = value; },
  };
}

function settingsWith(diagrams: Partial<DocumentSettingsV1["diagrams"]>): DocumentSettingsV1 {
  return { ...DEFAULT_DOCUMENT_SETTINGS, diagrams: { ...DEFAULT_DOCUMENT_SETTINGS.diagrams, ...diagrams } };
}

describe("parseFontSize", () => {
  it("reads absolute units as px", () => {
    expect(parseFontSize("12")).toBe(12);
    expect(parseFontSize("12px")).toBe(12);
    expect(parseFontSize("12pt")).toBeCloseTo(16, 5);
    expect(parseFontSize(" 1in ")).toBe(96);
  });

  it("rejects sizes that depend on an inherited value", () => {
    expect(parseFontSize("1.5em")).toBeNull();
    expect(parseFontSize("120%")).toBeNull();
    expect(parseFontSize("")).toBeNull();
    expect(parseFontSize("-4px")).toBeNull();
  });
});

describe("style properties", () => {
  it("reads a property without matching a similarly named one", () => {
    expect(readStyleProperty("font-size:12px;font-family:Arial", "font-family")).toBe("Arial");
    expect(readStyleProperty("font-size:12px", "font-family")).toBeNull();
  });

  it("replaces an existing property and appends a missing one", () => {
    expect(writeStyleProperty("font-family:Arial;fill:#000", "font-family", "Georgia")).toBe("font-family:Georgia;fill:#000");
    expect(writeStyleProperty("fill:#000", "font-family", "Georgia")).toBe("fill:#000;font-family:Georgia");
    expect(writeStyleProperty("", "font-family", "Georgia")).toBe("font-family:Georgia");
  });
});

describe("dominantFontSize", () => {
  it("takes the median so a big title does not skew the diagram", () => {
    expect(dominantFontSize([10, 10, 10, 48])).toBe(10);
    expect(dominantFontSize([8, 12])).toBe(10);
    expect(dominantFontSize([])).toBeNull();
  });
});

describe("diagramDisplayWidthPx", () => {
  const page = { size: "A4", orientation: "portrait", showMarginGuides: true, marginsMm: { top: 22, right: 20, bottom: 22, left: 24 } } as const;

  it("scales the drawing so its labels land on the body size", () => {
    // Labels drawn at 7 user units must double to reach 10.5pt (14px).
    const width = diagramDisplayWidthPx({
      viewBoxWidth: 300,
      dominantSize: 7,
      bodySizePt: 10.5,
      contentWidthMm: contentWidthMm(page),
      sizeScale: 1,
    });
    expect(width).toBeCloseTo(600, 5);
  });

  it("never draws wider than the printable page body", () => {
    const maxPx = contentWidthMm(page) * (96 / 25.4);
    const width = diagramDisplayWidthPx({
      viewBoxWidth: 4000,
      dominantSize: 4,
      bodySizePt: 10.5,
      contentWidthMm: contentWidthMm(page),
      sizeScale: 1,
    });
    expect(width).toBeCloseTo(maxPx, 5);
  });

  it("applies the tuning multiplier and refuses unusable input", () => {
    const base = { viewBoxWidth: 100, dominantSize: 14, bodySizePt: 10.5, contentWidthMm: 1000, sizeScale: 1 };
    expect(diagramDisplayWidthPx(base)).toBeCloseTo(100, 5);
    expect(diagramDisplayWidthPx({ ...base, sizeScale: 1.5 })).toBeCloseTo(150, 5);
    expect(diagramDisplayWidthPx({ ...base, dominantSize: 0 })).toBeNull();
  });
});

describe("applyDocumentTypography", () => {
  const root = () => node({ viewBox: "0 0 300 150" });

  it("overrides the font on the attribute and inside an inline style", () => {
    const plain = node({ "font-size": "7" });
    const styled = node({ style: "font-family:Arial;fill:#000", "font-size": "7" });
    const document = { documentElement: root(), getElementsByTagName: () => [] };

    applyDocumentTypography(document, [plain, styled] as SvgElement[], settingsWith({ matchFont: true }));

    expect(plain.values["font-family"]).toContain("Segoe UI");
    // The inline style wins over the attribute, so it must be rewritten as well.
    expect(styled.values.style).toContain("font-family:\"Segoe UI\"");
    expect(styled.values.style).toContain("fill:#000");
  });

  it("scales the drawing instead of resizing text, leaving font-size untouched", () => {
    const label = node({ "font-size": "7" });
    const documentRoot = root();
    const document = { documentElement: documentRoot, getElementsByTagName: () => [] };

    applyDocumentTypography(document, [label] as SvgElement[], settingsWith({ sizeMode: "scale" }));

    expect(documentRoot.values.width).toBe("600");
    expect(documentRoot.values.height).toBe("300");
    expect(label.values["font-size"]).toBe("7");
  });

  it("falls back to a size inherited from a group", () => {
    const label = node({});
    const group = node({ style: "font-size:7px" });
    const documentRoot = root();
    const document = { documentElement: documentRoot, getElementsByTagName: () => [group] as SvgElement[] };

    applyDocumentTypography(document, [label] as SvgElement[], settingsWith({ sizeMode: "scale" }));

    expect(documentRoot.values.width).toBe("600");
  });

  it("leaves a diagram alone when it has no viewBox or no usable size", () => {
    const withoutViewBox = node({});
    applyDocumentTypography(
      { documentElement: withoutViewBox, getElementsByTagName: () => [] },
      [node({ "font-size": "7" })] as SvgElement[],
      settingsWith({ sizeMode: "scale" }),
    );
    expect(withoutViewBox.values.width).toBeUndefined();

    const unmeasurable = root();
    applyDocumentTypography(
      { documentElement: unmeasurable, getElementsByTagName: () => [] },
      [node({ "font-size": "1.5em" })] as SvgElement[],
      settingsWith({ sizeMode: "scale" }),
    );
    expect(unmeasurable.values.width).toBeUndefined();
  });
});

describe("rewrite mode", () => {
  const root = () => node({ viewBox: "0 0 300 150" });

  it("moves every size by one factor, keeping the diagram's own hierarchy", () => {
    const label = node({ "font-size": "7" });
    const title = node({ "font-size": "14" });
    const documentRoot = root();

    applyDocumentTypography(
      { documentElement: documentRoot, getElementsByTagName: () => [] },
      [label, title] as SvgElement[],
      settingsWith({ sizeMode: "rewrite" }),
    );

    // Median 10.5 → 14px target, so everything grows by 4/3 and the title stays twice the label.
    expect(Number(label.values["font-size"])).toBeCloseTo(9.333, 3);
    expect(Number(title.values["font-size"])).toBeCloseTo(18.667, 3);
    // The drawing itself keeps its size — that is the trade-off against overflow.
    expect(documentRoot.values.width).toBeUndefined();
  });

  it("keeps the author's unit and rewrites sizes held in a style", () => {
    const label = node({ style: "font-size:7pt;fill:#000" });

    applyDocumentTypography(
      { documentElement: root(), getElementsByTagName: () => [] },
      [label] as SvgElement[],
      settingsWith({ sizeMode: "rewrite" }),
    );

    expect(label.values.style).toBe("font-size:10.5pt;fill:#000");
  });
});

describe("per-graphic scale override", () => {
  const root = () => node({ viewBox: "0 0 300 150" });

  it("replaces the document multiplier for that one graphic", () => {
    const documentRoot = root();
    applyDocumentTypography(
      { documentElement: documentRoot, getElementsByTagName: () => [] },
      [node({ "font-size": "7" })] as SvgElement[],
      settingsWith({ sizeMode: "scale", sizeScale: 1 }),
      0.5,
    );
    expect(documentRoot.values.width).toBe("300");
  });

  it("falls back to the document multiplier when unset or unusable", () => {
    for (const override of [null, undefined, 0]) {
      const documentRoot = root();
      applyDocumentTypography(
        { documentElement: documentRoot, getElementsByTagName: () => [] },
        [node({ "font-size": "7" })] as SvgElement[],
        settingsWith({ sizeMode: "scale", sizeScale: 0.75 }),
        override,
      );
      expect(documentRoot.values.width).toBe("450");
    }
  });

  it("still respects the page clamp when the override is large", () => {
    const documentRoot = root();
    applyDocumentTypography(
      { documentElement: documentRoot, getElementsByTagName: () => [] },
      [node({ "font-size": "7" })] as SvgElement[],
      settingsWith({ sizeMode: "scale", sizeScale: 1 }),
      4,
    );
    expect(Number(documentRoot.values.width)).toBeCloseTo(contentWidthMm(DEFAULT_DOCUMENT_SETTINGS.page) * (96 / 25.4), 1);
  });
});

describe("page geometry", () => {
  it("subtracts margins and swaps the page edge when landscape", () => {
    const margins = { top: 22, right: 20, bottom: 22, left: 24 };
    expect(contentWidthMm({ size: "A4", orientation: "portrait", showMarginGuides: true, marginsMm: margins })).toBeCloseTo(166, 5);
    expect(contentWidthMm({ size: "A4", orientation: "landscape", showMarginGuides: true, marginsMm: margins })).toBeCloseTo(253, 5);
  });

  it("parses a viewBox and rejects a malformed one", () => {
    expect(parseViewBox("0 0 300 150")).toEqual({ width: 300, height: 150 });
    expect(parseViewBox("0,0,300,150")).toEqual({ width: 300, height: 150 });
    expect(parseViewBox("0 0 300")).toBeNull();
    expect(parseViewBox(null)).toBeNull();
  });
});
