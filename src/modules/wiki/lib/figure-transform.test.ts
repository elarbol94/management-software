import { describe, expect, it } from "vitest";
import { figureResizeDelta, transformFigureCrop } from "./figure-transform";

describe("visual crop gestures", () => {
  const crop = { x: 0.2, y: 0.1, width: 0.6, height: 0.7 };
  it("moves a crop inside the original without changing its size", () => {
    expect(transformFigureCrop(crop, "move", 2, -2)).toEqual({ ...crop, x: 0.4, y: 0 });
  });
  it("anchors the opposite corner and prevents inversion", () => {
    const result = transformFigureCrop(crop, "nw", 2, 2);
    expect(result.width).toBeCloseTo(0.05);
    expect(result.height).toBeCloseTo(0.05);
    expect(result.x + result.width).toBeCloseTo(0.8);
    expect(result.y + result.height).toBeCloseTo(0.8);
  });
  it("constrains expansion at the original image boundary", () => {
    const result = transformFigureCrop(crop, "se", 2, 2);
    expect(result).toEqual({ x: 0.2, y: 0.1, width: 0.8, height: 0.9 });
    const upperRight = transformFigureCrop(crop, "ne", 2, -2);
    expect(upperRight).toMatchObject({ x: 0.2, y: 0, width: 0.8 });
    expect(upperRight.height).toBeCloseTo(0.8);
  });
});

describe("figure resize direction", () => {
  it("follows the free edge for left, centred, and right alignment", () => {
    expect(figureResizeDelta(10, "left", "none")).toBe(10);
    expect(figureResizeDelta(10, "center", "none")).toBe(20);
    expect(figureResizeDelta(-10, "right", "none")).toBe(10);
  });
  it("uses the float edge when text wrapping is active", () => {
    expect(figureResizeDelta(10, "center", "left")).toBe(10);
    expect(figureResizeDelta(-10, "left", "right")).toBe(10);
  });
});
