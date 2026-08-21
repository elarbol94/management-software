import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { analyzeMunicipalityMinute } from "../src/modules/municipalities/minutes-ai";
import { dateFromMinutePath, dateFromMinuteText, type MinuteTextPage } from "../src/modules/municipalities/minutes";

const execFileAsync = promisify(execFile);

type Options = {
  source: string; output: string; municipalityCode: string; municipalityName: string;
  analyze: boolean; ocr: boolean; force: boolean; limit: number | null;
};

type ExtractedDocument = {
  schemaVersion: 1;
  municipalityCode: string;
  municipalityName: string;
  documentId: string;
  meetingDate: string | null;
  year: number | null;
  source: { relativePath: string; sizeBytes: number; sha256: string };
  pageCount: number;
  pages: MinuteTextPage[];
  quality: { complete: boolean; nativePages: number; ocrPages: number; emptyPages: number; requiresOcr: boolean };
};

function optionValue(args: string[], key: string) {
  const position = args.indexOf(key);
  return position >= 0 ? args[position + 1] : undefined;
}

function optionsFromArgs(args: string[]): Options {
  const source = optionValue(args, "--source");
  const output = optionValue(args, "--output");
  const municipalityCode = optionValue(args, "--municipality-code");
  const municipalityName = optionValue(args, "--municipality-name");
  if (!source || !output || !municipalityCode || !municipalityName || !/^\d{5}$/.test(municipalityCode)) {
    throw new Error("Usage: --source PATH --output PATH --municipality-code 12345 --municipality-name NAME [--ocr] [--analyze] [--force] [--limit N]");
  }
  const rawLimit = optionValue(args, "--limit");
  const limit = rawLimit === undefined ? null : Number(rawLimit);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive integer");
  return {
    source: path.resolve(source), output: path.resolve(output), municipalityCode, municipalityName,
    analyze: args.includes("--analyze"), ocr: args.includes("--ocr"), force: args.includes("--force"), limit,
  };
}

async function listPdfs(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listPdfs(absolute));
    else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".pdf")) result.push(absolute);
  }
  return result.sort((left, right) => left.localeCompare(right, "de-AT"));
}

async function sha256(file: string) {
  const hash = createHash("sha256");
  const handle = await fs.open(file, "r");
  try { for await (const chunk of handle.createReadStream()) hash.update(chunk); }
  finally { await handle.close(); }
  return hash.digest("hex");
}

async function run(command: string, args: string[], timeout = 120_000) {
  const result = await execFileAsync(command, args, { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
  return result.stdout;
}

async function commandExists(command: string) {
  try { await run(command, ["--version"], 10_000); return true; } catch { return false; }
}

function textIsUseful(text: string) {
  return (text.match(/[A-Za-zÄÖÜäöüß]/g)?.length ?? 0) >= 80;
}

async function pageCount(file: string) {
  const info = await run(process.env.PDFINFO_PATH || "pdfinfo", [file]);
  const value = Number(info.match(/^Pages:\s+(\d+)$/m)?.[1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`No page count for ${file}`);
  return value;
}

async function nativePageText(file: string, page: number) {
  return run(process.env.PDFTOTEXT_PATH || "pdftotext", ["-f", String(page), "-l", String(page), "-layout", "-enc", "UTF-8", file, "-"]);
}

async function ocrPageText(file: string, page: number) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "municipality-minute-ocr-"));
  try {
    const prefix = path.join(temporary, "page");
    try {
      await run(process.env.PDFTOPPM_PATH || "pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-mono", "-r", "150", "-png", file, prefix], 120_000);
      return await run(process.env.TESSERACT_PATH || "tesseract", [`${prefix}.png`, "stdout", "-l", process.env.PDF_OCR_LANGUAGES || "deu+eng", "--dpi", "150", "--psm", "3"], 300_000);
    } catch {
      try {
        await fs.rm(`${prefix}.png`, { force: true });
        await run(process.env.PDFTOPPM_PATH || "pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-mono", "-r", "100", "-png", file, prefix], 120_000);
        return await run(process.env.TESSERACT_PATH || "tesseract", [`${prefix}.png`, "stdout", "-l", "deu", "--dpi", "100", "--psm", "6"], 300_000);
      } catch {
        process.stderr.write(`OCR failed for ${file}, page ${page}\n`);
        return "";
      }
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function atomicJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
  await fs.rename(temporary, file);
}

async function extractDocument(options: Options, file: string, digest: string) {
  const relativePath = path.relative(options.source, file).split(path.sep).join("/");
  const initialDate = dateFromMinutePath(relativePath);
  const idDate = initialDate ?? relativePath.match(/(?:^|\/)(20\d{2})(?:\/|$)/)?.[1] ?? "unknown";
  const documentId = `${options.municipalityCode}-${idDate}-${digest.slice(0, 12)}`;
  const outputFile = path.join(options.output, "documents", `${documentId}.json`);
  if (!options.force) {
    try {
      const existing = JSON.parse(await fs.readFile(outputFile, "utf8")) as ExtractedDocument;
      if (!options.ocr || existing.quality.complete) return existing;
    } catch {
      // Extract missing or invalid output below.
    }
  }
  const count = await pageCount(file);
  const pages = new Array<MinuteTextPage>(count);
  const configuredConcurrency = Number(process.env.MINUTES_PAGE_CONCURRENCY || 2);
  const concurrency = Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
    ? Math.min(configuredConcurrency, count)
    : Math.min(2, count);
  let nextPage = 1;
  async function processPages() {
    while (nextPage <= count) {
      const page = nextPage;
      nextPage += 1;
      const nativeText = (await nativePageText(file, page)).trim();
      if (textIsUseful(nativeText)) pages[page - 1] = { page, text: nativeText, extractionMethod: "native" };
      else if (options.ocr) {
        const ocrText = (await ocrPageText(file, page)).trim();
        pages[page - 1] = { page, text: ocrText, extractionMethod: textIsUseful(ocrText) ? "ocr" : "empty" };
      } else pages[page - 1] = { page, text: nativeText, extractionMethod: "empty" };
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => processPages()));
  const meetingDate = initialDate ?? dateFromMinuteText(pages.slice(0, 2).map((page) => page.text).join("\n"));
  const stat = await fs.stat(file);
  const nativePages = pages.filter((page) => page.extractionMethod === "native").length;
  const ocrPages = pages.filter((page) => page.extractionMethod === "ocr").length;
  const emptyPages = pages.filter((page) => page.extractionMethod === "empty").length;
  const document: ExtractedDocument = {
    schemaVersion: 1, municipalityCode: options.municipalityCode, municipalityName: options.municipalityName,
    documentId, meetingDate,
    year: meetingDate ? Number(meetingDate.slice(0, 4)) : Number(relativePath.match(/(?:^|\/)(20\d{2})(?:\/|$)/)?.[1]) || null,
    source: { relativePath, sizeBytes: stat.size, sha256: digest }, pageCount: count, pages,
    quality: { complete: emptyPages === 0, nativePages, ocrPages, emptyPages, requiresOcr: emptyPages > 0 },
  };
  await atomicJson(outputFile, document);
  return document;
}

async function main() {
  const options = optionsFromArgs(process.argv.slice(2));
  if (options.analyze && !process.env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY is required with --analyze");
  if (options.ocr && !await commandExists(process.env.TESSERACT_PATH || "tesseract")) throw new Error("Tesseract is required with --ocr");
  const allFiles = await listPdfs(options.source);
  const files = options.limit ? allFiles.slice(0, options.limit) : allFiles;
  const seen = new Map<string, string>();
  const manifestDocuments: Array<Record<string, unknown>> = [];
  let processed = 0;
  for (const file of files) {
    const digest = await sha256(file);
    const relativePath = path.relative(options.source, file).split(path.sep).join("/");
    const duplicateOf = seen.get(digest) ?? null;
    if (duplicateOf) {
      manifestDocuments.push({ relativePath, sha256: digest, duplicateOf });
      continue;
    }
    const document = await extractDocument(options, file, digest);
    seen.set(digest, document.documentId);
    let analysisStatus = "not_requested";
    if (options.analyze && document.quality.complete) {
      const analysisFile = path.join(options.output, "analyses", `${document.documentId}.json`);
      let exists = false;
      if (!options.force) { try { await fs.access(analysisFile); exists = true; } catch { /* analyze below */ } }
      if (exists) analysisStatus = "ready";
      else {
        const analysis = await analyzeMunicipalityMinute({
          municipalityCode: options.municipalityCode, municipalityName: options.municipalityName,
          documentId: document.documentId, expectedMeetingDate: document.meetingDate,
          pages: document.pages, safetyIdentifier: `municipality-${options.municipalityCode}`,
        });
        if (analysis) { await atomicJson(analysisFile, analysis); analysisStatus = "ready"; }
        else analysisStatus = "failed_validation";
      }
    } else if (options.analyze) analysisStatus = "blocked_by_ocr";
    manifestDocuments.push({
      documentId: document.documentId, relativePath, sha256: digest, meetingDate: document.meetingDate,
      pageCount: document.pageCount, quality: document.quality, analysisStatus, duplicateOf: null,
    });
    processed += 1;
    process.stdout.write(`[${processed}/${files.length}] ${relativePath}\n`);
  }
  const years = manifestDocuments.flatMap((item) => typeof item.meetingDate === "string" ? [Number(item.meetingDate.slice(0, 4))] : []);
  const manifest = {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    municipality: { code: options.municipalityCode, name: options.municipalityName }, sourceDirectory: options.source,
    filesFound: files.length, uniqueDocuments: seen.size, exactDuplicates: files.length - seen.size,
    coverage: { fromYear: years.length ? Math.min(...years) : null, toYear: years.length ? Math.max(...years) : null },
    documents: manifestDocuments,
  };
  await atomicJson(path.join(options.output, "manifest.json"), manifest);
  process.stdout.write(`Manifest: ${path.join(options.output, "manifest.json")}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
