import { describe, expect, it } from "vitest";
import { extractSvgTextLayers } from "./lib/svg-text";

describe("SVG text layers", () => {
  it("extracts stable leaf text and bindings", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text data-wiki-text-id="title"><tspan data-wiki-text-id="line-1">Hello</tspan></text><text data-wiki-text-id="plain">World</text></svg>`;
    expect(extractSvgTextLayers(svg, JSON.stringify({ plain: "title" }))).toEqual([
      { id: "plain", text: "World", binding: "title" },
      { id: "line-1", text: "Hello", binding: "" },
    ]);
  });

  it("ignores non-text geometry", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>`;
    expect(extractSvgTextLayers(svg)).toEqual([]);
  });
});
