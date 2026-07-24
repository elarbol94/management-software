import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const chunksDirectory = path.join(process.cwd(), ".next", "static", "chunks");
if (!fs.existsSync(chunksDirectory)) {
  throw new Error("Missing .next output. Run npm run build first.");
}

const files = fs
  .readdirSync(chunksDirectory)
  .filter((name) => name.endsWith(".js") || name.endsWith(".css"))
  .map((name) => {
    const bytes = fs.readFileSync(path.join(chunksDirectory, name));
    return {
      name,
      rawBytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
    };
  });

const javascript = files.filter((file) => file.name.endsWith(".js"));
const styles = files.filter((file) => file.name.endsWith(".css"));
const largest = [...javascript].sort((a, b) => b.gzipBytes - a.gzipBytes)[0];
const totalJavaScript = javascript.reduce((sum, file) => sum + file.gzipBytes, 0);
const totalStyles = styles.reduce((sum, file) => sum + file.gzipBytes, 0);

const budgets = {
  largestJavaScriptChunk: 200 * 1024,
  totalJavaScript: 2_000 * 1024,
  totalStyles: 80 * 1024,
};

console.table(
  [...files]
    .sort((a, b) => b.gzipBytes - a.gzipBytes)
    .slice(0, 15)
    .map((file) => ({
      file: file.name,
      rawKB: (file.rawBytes / 1024).toFixed(1),
      gzipKB: (file.gzipBytes / 1024).toFixed(1),
    })),
);

const failures = [];
if ((largest?.gzipBytes ?? 0) > budgets.largestJavaScriptChunk) {
  failures.push(
    `Largest JS chunk is ${(largest.gzipBytes / 1024).toFixed(1)} KB gzip`,
  );
}
if (totalJavaScript > budgets.totalJavaScript) {
  failures.push(
    `Total JS is ${(totalJavaScript / 1024).toFixed(1)} KB gzip`,
  );
}
if (totalStyles > budgets.totalStyles) {
  failures.push(`Total CSS is ${(totalStyles / 1024).toFixed(1)} KB gzip`);
}
if (failures.length > 0) {
  throw new Error(`Performance budget exceeded:\n${failures.join("\n")}`);
}

console.log(
  `Performance budgets passed: JS ${(totalJavaScript / 1024).toFixed(1)} KB gzip, CSS ${(totalStyles / 1024).toFixed(1)} KB gzip.`,
);
