import { describe, expect, it } from "vitest";
import { figureRepairs } from "./figure-identity";
import { folderPermission, readFigureFolderFile } from "./figure-folder";
import type { DirectoryHandle } from "./svg-folder-source";
import { Schema } from "@tiptap/pm/model";
import { documentFigures, figureCrop, relativeFigurePath, stripFigureNumber } from "./figure";
import { normalizeFigureSvg } from "./figure-svg";

describe("figure semantics", () => {
  it("normalizes only recognized prefixes, including sidecar placeholders", () => {
    expect(stripFigureNumber(" Abbildung X: Haushaltseinkommen")).toBe("Haushaltseinkommen");
    expect(stripFigureNumber("Fig. 19 — Revenue")).toBe("Revenue");
    expect(stripFigureNumber("2026: Forecast")).toBe("2026: Forecast");
    expect(stripFigureNumber("In Abbildung 3 steht …")).toBe("In Abbildung 3 steht …");
  });
  it("numbers independently of index inclusion and includes native diagrams", () => {
    expect(documentFigures({ type: "doc", content: [
      { type: "commentableImage", attrs: { nodeId: "decoration", numbered: false } },
      { type: "commentableImage", attrs: { nodeId: "one", numbered: true, includeInFigureIndex: false, caption: "Abbildung 8: First" } },
      { type: "mermaidDiagram", attrs: { nodeId: "two", caption: "Flow" } },
    ] }).map(({ nodeId, number, included, caption }) => ({ nodeId, number, included, caption }))).toEqual([
      { nodeId: "one", number: 1, included: false, caption: "First" }, { nodeId: "two", number: 2, included: true, caption: "Flow" },
    ]);
  });
  it("confines full and relative laptop paths to their declared folder", () => {
    expect(relativeFigurePath("C:\\Research\\plots\\result.svg", "c:\\research")).toBe("plots/result.svg");
    for (const input of ["../secret.svg", "/etc/private.svg", "C:\\Other\\plot.svg", "plots//a.svg", "a/../../b.svg", "a.svg\u0000"]) expect(() => relativeFigurePath(input, "C:\\Research")).toThrow("invalidPath");
  });
  it("keeps crop rectangles nonempty and within the original artwork", () => {
    expect(figureCrop({ x: .8, width: .9, y: -.3, height: 0 })).toEqual({ x: .8, width: expect.closeTo(.2), y: 0, height: .05 });
  });
  it("normalizes Python-style SVG while rejecting active and external content", () => {
    const svg = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><style>* {stroke-linejoin:round} .plot {fill:red}</style><path class="plot" d="M0 0h10v10z"/></svg>';
    const normalized = normalizeFigureSvg(svg);
    expect(normalized).not.toMatch(/<!DOCTYPE|<style/);
    expect(normalized).toContain("stroke-linejoin:round");
    expect(normalized).toContain("fill:red");
    expect(() => normalizeFigureSvg('<svg><script>alert(1)</script></svg>')).toThrow();
    expect(() => normalizeFigureSvg('<svg><image href="https://example.org/x.png"/></svg>')).toThrow();
    expect(() => normalizeFigureSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg>&x;</svg>')).toThrow();
  });
});

// A schema-only fixture for identity tests avoids requiring a browser.
export const figureTestSchema = new Schema({ nodes: { doc: { content: "block+" }, paragraph: { group: "block", content: "inline*" }, text: { group: "inline" }, commentableImage: { group: "block", atom: true, attrs: { nodeId: { default: "" }, caption: { default: "" } } } } });

it("preserves the original identity when a duplicate is inserted before it", () => {
  const image = figureTestSchema.nodes.commentableImage.create({ nodeId: "original", caption: "Abbildung X: Chart " });
  const doc = figureTestSchema.nodes.doc.create(null, [image, image]);
  const repairs = figureRepairs(doc, new Map([["original", 1]]));
  expect(repairs[0].position).toBe(0); expect(repairs[0].attrs.nodeId).not.toBe("original");
  expect(repairs[1].attrs).toMatchObject({ nodeId: "original", caption: "Chart " });
  expect(figureRepairs(figureTestSchema.nodes.doc.create(null, [figureTestSchema.nodes.commentableImage.create({ nodeId: "original", caption: "Chart " })]))).toEqual([]);
});
it("resolves a replaced laptop file by path and never requests permission during polling", async () => {
  let contents = "first";
  let permissionRequests = 0;
  const handle: DirectoryHandle = { kind: "directory", name: "Plots", async *values() { const value = contents; yield { kind: "file", name: "chart.svg", getFile: async () => new File([value], "chart.svg") }; }, queryPermission: async () => "prompt", requestPermission: async () => { permissionRequests++; return "granted"; } };
  const folder = { handle, prefix: "C:\\Plots" };
  expect(await (await readFigureFolderFile(folder, "chart.svg")).text()).toBe("first");
  contents = "replacement";
  expect(await (await readFigureFolderFile(folder, "chart.svg")).text()).toBe("replacement");
  expect(await folderPermission(handle, false)).toBe("prompt"); expect(permissionRequests).toBe(0);
  expect(await folderPermission(handle, true)).toBe("granted"); expect(permissionRequests).toBe(1);
  await expect(readFigureFolderFile(folder, "missing.svg")).rejects.toThrow("sourceUnavailable");
});
