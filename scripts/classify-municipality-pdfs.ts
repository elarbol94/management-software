import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LETTER_THRESHOLD = 80;

type Result = {
  file: string;
  status: "text" | "mixed" | "scan" | "error";
  pages: number;
  nativePages: number;
  emptyPages: number;
  characters: number;
  sizeBytes: number;
  durationSeconds: number;
  error?: string;
};

function optionValue(args: string[], key: string) {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.replaceAll("\n", " ").slice(0, 500);
  return String(error).slice(0, 500);
}

async function listPdfs(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listPdfs(absolute));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) files.push(absolute);
  }
  return files.sort((a, b) => a.localeCompare(b, "de-AT"));
}

async function classify(source: string, root: string): Promise<Result> {
  const started = Date.now();
  const relative = path.relative(root, source);
  const sizeBytes = (await fs.stat(source)).size;
  try {
    const result = await execFileAsync(
      process.env.PDFTOTEXT_PATH || "pdftotext",
      ["-layout", "-enc", "UTF-8", source, "-"],
      { encoding: "utf8", timeout: 180_000, maxBuffer: 128 * 1024 * 1024 },
    );
    const pages = result.stdout.split("\f");
    if (pages.at(-1)?.trim() === "") pages.pop();
    const nativePages = pages.filter((page) => (page.match(/[A-Za-zÄÖÜäöüß]/g)?.length ?? 0) >= LETTER_THRESHOLD).length;
    const emptyPages = Math.max(0, pages.length - nativePages);
    const status = nativePages === 0 ? "scan" : emptyPages === 0 ? "text" : "mixed";
    return {
      file: relative, status, pages: pages.length, nativePages, emptyPages,
      characters: result.stdout.length, sizeBytes,
      durationSeconds: (Date.now() - started) / 1000,
    };
  } catch (error) {
    return {
      file: relative, status: "error", pages: 0, nativePages: 0, emptyPages: 0,
      characters: 0, sizeBytes, durationSeconds: (Date.now() - started) / 1000,
      error: errorMessage(error),
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const source = optionValue(args, "--source");
  const output = optionValue(args, "--output");
  const workers = Number(optionValue(args, "--workers") || "3");
  if (!source || !output || !Number.isInteger(workers) || workers < 1 || workers > 8) {
    throw new Error("Usage: --source PATH --output PATH [--workers 3] [--force]");
  }
  const root = path.resolve(source);
  const outputRoot = path.resolve(output);
  const relativeOutput = path.relative(root, outputRoot);
  if (root === outputRoot || (!relativeOutput.startsWith("..") && !path.isAbsolute(relativeOutput))) {
    throw new Error("--output must be outside --source");
  }
  await fs.mkdir(outputRoot, { recursive: true });
  const jsonlFile = path.join(outputRoot, "classification.jsonl");
  const summaryFile = path.join(outputRoot, "classification-summary.json");
  const processed = new Set<string>();
  if (!args.includes("--force")) {
    try {
      for (const line of (await fs.readFile(jsonlFile, "utf8")).split("\n")) {
        if (!line.trim()) continue;
        try { processed.add((JSON.parse(line) as Result).file); } catch { /* ignore incomplete last line */ }
      }
    } catch { /* first run */ }
  } else {
    await fs.rm(jsonlFile, { force: true });
    await fs.rm(summaryFile, { force: true });
  }

  const allFiles = await listPdfs(root);
  const files = allFiles.filter((file) => !processed.has(path.relative(root, file)));
  let cursor = 0;
  let completed = processed.size;
  const counts = { text: 0, mixed: 0, scan: 0, error: 0 };
  let writeChain = Promise.resolve();
  const append = (result: Result) => {
    writeChain = writeChain.then(() => fs.appendFile(jsonlFile, `${JSON.stringify(result)}\n`));
    counts[result.status] += 1;
    completed += 1;
    if (completed % 100 === 0 || completed === allFiles.length) {
      process.stdout.write(`[${completed}/${allFiles.length}] text=${counts.text} mixed=${counts.mixed} scan=${counts.scan} error=${counts.error}\n`);
    }
  };

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= files.length) return;
      append(await classify(files[index], root));
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, files.length || 1) }, () => worker()));
  await writeChain;
  const summary = {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    source: root,
    totalPdfs: allFiles.length,
    resumed: processed.size,
    workers,
    letterThreshold: LETTER_THRESHOLD,
    counts,
  };
  await fs.writeFile(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`Done: ${allFiles.length} PDFs classified.\n`);
}

main().catch((error) => {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
});
