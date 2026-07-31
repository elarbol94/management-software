import { describe, expect, it } from "vitest";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { extractSvgTextLayers, ownSvgText, setOwnSvgText, writeSvgNumber } from "./lib/svg-text";

describe("SVG text layers", () => {
  it("extracts stable leaf text and bindings", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text data-wiki-text-id="title"><tspan data-wiki-text-id="line-1">Hello</tspan></text><text data-wiki-text-id="plain">World</text></svg>`;
    expect(extractSvgTextLayers(svg, JSON.stringify({ plain: "title" }))).toEqual([
      { id: "plain", text: "World", binding: "title", fontSize: null, x: null, y: null },
      { id: "line-1", text: "Hello", binding: "", fontSize: null, x: null, y: null },
    ]);
  });

  it("ignores non-text geometry", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>`;
    expect(extractSvgTextLayers(svg)).toEqual([]);
  });

  it("exposes the text an element owns next to its children", () => {
    // The headline number in "4.025 €/Monat": editable without touching the unit.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text x="40" y="114" font-size="25" data-wiki-text-id="svg-label-1">4.025<tspan font-size="13" data-wiki-text-id="svg-text-1"> €/Monat</tspan></text></svg>`;
    expect(extractSvgTextLayers(svg)).toEqual([
      { id: "svg-label-1", text: "4.025", binding: "", fontSize: 25, x: 40, y: 114 },
      { id: "svg-text-1", text: " €/Monat", binding: "", fontSize: 13, x: null, y: null },
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

  it("writes geometry only where it moved", () => {
    const document = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg"><text x="40" y="114">a</text><text>b</text></svg>`,
      "image/svg+xml",
    );
    const [positioned, inherited] = Array.from(document.getElementsByTagName("text"));
    writeSvgNumber(positioned, "x", 40);
    writeSvgNumber(positioned, "y", 130.126);
    // An element with no x of its own inherits one; giving it a value would move it.
    writeSvgNumber(inherited, "x", 12);
    const svg = new XMLSerializer().serializeToString(document);
    expect(svg).toContain(`<text x="40" y="130.13">a</text>`);
    expect(svg).toContain(`<text>b</text>`);
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
