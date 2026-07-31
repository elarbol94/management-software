import { describe, expect, it } from "vitest";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { extractSvgTextLayers, ownSvgText, setOwnSvgText } from "./lib/svg-text";

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

  it("exposes the text an element owns next to its children", () => {
    // The headline number in "4.025 €/Monat": editable without touching the unit.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text data-wiki-text-id="svg-label-1">4.025<tspan data-wiki-text-id="svg-text-1"> €/Monat</tspan></text></svg>`;
    expect(extractSvgTextLayers(svg)).toEqual([
      { id: "svg-label-1", text: "4.025", binding: "" },
      { id: "svg-text-1", text: " €/Monat", binding: "" },
    ]);
  });

  it("keeps a rewritten headline in front of its unit", () => {
    const document = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg"><text id="a">4.025<tspan> €/Monat</tspan></text></svg>`,
      "image/svg+xml",
    );
    const element = document.getElementsByTagName("text")[0];
    expect(ownSvgText(element)).toBe("4.025");
    setOwnSvgText(element, "4.200");
    expect(new XMLSerializer().serializeToString(document)).toContain(`<text id="a">4.200<tspan> €/Monat</tspan></text>`);
  });

  it("leaves nothing behind when the owned text is cleared", () => {
    const document = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg"><tspan id="a">x</tspan></svg>`,
      "image/svg+xml",
    );
    const element = document.getElementsByTagName("tspan")[0];
    setOwnSvgText(element, "");
    // `<tspan/>` and `<tspan></tspan>` differ to the serializer, and a spurious
    // difference would make an unchanged save look like an edit.
    expect(new XMLSerializer().serializeToString(document)).toContain(`<tspan id="a"/>`);
  });
});
