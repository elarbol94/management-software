import { describe, expect, it } from "vitest";
import { collectSvgFiles, type DirectoryHandle } from "./svg-folder-source";

function file(name: string) {
  return { kind: "file" as const, name, getFile: async () => new File([`<svg/>`], name) };
}

function directory(name: string, children: Array<DirectoryHandle | ReturnType<typeof file>>): DirectoryHandle {
  return { kind: "directory", name, values: () => children[Symbol.iterator]() as never };
}

describe("collectSvgFiles", () => {
  it("returns folder-relative paths and skips non-SVG files", async () => {
    const tree = directory("svg", [
      file("01-overview.svg"),
      file("notes.txt"),
      directory("archive", [file("02-detail.svg"), file("thumb.png")]),
    ]);

    const found = await collectSvgFiles(tree);

    expect(found.map((entry) => entry.path)).toEqual(["01-overview.svg", "archive/02-detail.svg"]);
  });

  it("keeps paths unique across folders so identically named files stay separate assets", async () => {
    const tree = directory("svg", [
      directory("a", [file("diagram.svg")]),
      directory("b", [file("diagram.svg")]),
    ]);

    const found = await collectSvgFiles(tree);

    expect(found.map((entry) => entry.path)).toEqual(["a/diagram.svg", "b/diagram.svg"]);
  });
});
