import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve("maplibre-gl/package.json"));
const sourceDirectory = path.join(packageRoot, "dist");
const targetDirectory = path.resolve("public/vendor/maplibre-gl");
const assets = [
  ["maplibre-gl-worker.mjs", path.join(sourceDirectory, "maplibre-gl-worker.mjs")],
  ["maplibre-gl-shared.mjs", path.join(sourceDirectory, "maplibre-gl-shared.mjs")],
  ["LICENSE.txt", path.join(packageRoot, "LICENSE.txt")],
];

await mkdir(targetDirectory, { recursive: true });
await Promise.all(
  assets.map(([fileName, source]) =>
    copyFile(source, path.join(targetDirectory, fileName)),
  ),
);

console.log(
  `MapLibre browser assets copied to ${path.relative(process.cwd(), targetDirectory)}.`,
);
