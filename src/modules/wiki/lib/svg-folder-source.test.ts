import { describe, expect, it } from "vitest";
import { batchGraphicsFiles, collectGraphicsFiles, type DirectoryHandle } from "./svg-folder-source";

function file(name: string) {
  return { kind: "file" as const, name, getFile: async () => new File([`<svg/>`], name) };
}

function directory(name: string, children: Array<DirectoryHandle | ReturnType<typeof file>>): DirectoryHandle {
  return { kind: "directory", name, values: () => children[Symbol.iterator]() as never };
}

describe("collectGraphicsFiles", () => {
  it("returns folder-relative paths and skips non-SVG files", async () => {
    const tree = directory("svg", [
      file("01-overview.svg"),
      file("notes.txt"),
      directory("archive", [file("02-detail.svg"), file("thumb.png")]),
    ]);

    const found = await collectGraphicsFiles(tree);

    expect(found.map((entry) => entry.path)).toEqual(["01-overview.svg", "archive/02-detail.svg"]);
  });

  it("collects json sidecars next to their graphic but ignores other files", async () => {
    const tree = directory("svg", [
      file("01_kennzahlen-wohlstand.svg"),
      file("01_kennzahlen-wohlstand.json"),
      file("readme.md"),
    ]);

    const found = await collectGraphicsFiles(tree);

    expect(found.map((entry) => entry.path)).toEqual([
      "01_kennzahlen-wohlstand.svg",
      "01_kennzahlen-wohlstand.json",
    ]);
  });

  it("keeps paths unique across folders so identically named files stay separate assets", async () => {
    const tree = directory("svg", [
      directory("a", [file("diagram.svg")]),
      directory("b", [file("diagram.svg")]),
    ]);

    const found = await collectGraphicsFiles(tree);

    expect(found.map((entry) => entry.path)).toEqual(["a/diagram.svg", "b/diagram.svg"]);
  });
});

describe("batchGraphicsFiles", () => {
  const pair = (name: string) => [{ path: `${name}.svg` }, { path: `${name}.json` }];

  it("never splits a graphic from its sidecar", () => {
    // A plain slice at size 3 would put 02's sidecar in the next request.
    const files = [...pair("01"), ...pair("02"), ...pair("03")];

    const batches = batchGraphicsFiles(files, 3);

    for (const batch of batches) {
      const names = batch.map((entry) => entry.path.replace(/\.[^.]+$/, ""));
      for (const name of new Set(names)) {
        expect(names.filter((entry) => entry === name)).toHaveLength(2);
      }
    }
    expect(batches.flat()).toHaveLength(6);
  });

  it("keeps batches within the size where pairs allow it", () => {
    const files = Array.from({ length: 10 }, (_, index) => ({ path: `${index}.svg` }));

    expect(batchGraphicsFiles(files, 4).map((batch) => batch.length)).toEqual([4, 4, 2]);
  });

  it("returns nothing for no files", () => {
    expect(batchGraphicsFiles([], 5)).toEqual([]);
  });
});
