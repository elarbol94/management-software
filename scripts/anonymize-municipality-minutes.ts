import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { findRedactionMatches, type OcrWord, type RedactionReason } from "../src/modules/municipalities/anonymization";

const execFileAsync = promisify(execFile);

type Options = { source: string; output: string; force: boolean; limit: number | null; dpi: number };
type TsvWord = OcrWord & { left: number; top: number; width: number; height: number };
type PageReport = { page: number; extractionMethod: "native" | "ocr"; fullyRedacted: boolean; redactions: number; byReason: Partial<Record<RedactionReason, number>> };

function optionValue(args: string[], key: string) {
  const position = args.indexOf(key);
  return position >= 0 ? args[position + 1] : undefined;
}

function optionsFromArgs(args: string[]): Options {
  const source = optionValue(args, "--source");
  const output = optionValue(args, "--output");
  if (!source || !output) throw new Error("Usage: --source PATH --output PATH [--force] [--limit N] [--dpi N]");
  const rawLimit = optionValue(args, "--limit");
  const limit = rawLimit === undefined ? null : Number(rawLimit);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive integer");
  const rawDpi = optionValue(args, "--dpi");
  const dpi = rawDpi === undefined ? 200 : Number(rawDpi);
  if (!Number.isInteger(dpi) || dpi < 100 || dpi > 400) throw new Error("--dpi must be an integer from 100 to 400");
  return { source: path.resolve(source), output: path.resolve(output), force: args.includes("--force"), limit, dpi };
}

async function run(command: string, args: string[], timeout = 300_000) {
  const result = await execFileAsync(command, args, { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
  return result.stdout;
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

async function pageCount(file: string) {
  const info = await run(process.env.PDFINFO_PATH || "pdfinfo", [file]);
  const value = Number(info.match(/^Pages:\s+(\d+)$/m)?.[1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`No page count for ${file}`);
  return value;
}

function parseTsv(tsv: string, page: number): TsvWord[] {
  const rows = tsv.trim().split("\n").slice(1);
  const words: TsvWord[] = [];
  for (const row of rows) {
    const columns = row.split("\t");
    if (columns.length < 12 || columns[0] !== "5" || !columns[11]?.trim()) continue;
    const [, block, paragraph, line, , left, top, width, height] = columns;
    words.push({
      id: words.length, text: columns.slice(11).join("\t").trim(),
      line: `${page}:${block}:${paragraph}:${line}`,
      left: Number(left), top: Number(top), width: Number(width), height: Number(height),
    });
  }
  return words.filter((word) => [word.left, word.top, word.width, word.height].every(Number.isFinite));
}

async function ocrPageWords(imagePath: string, page: number, dpi: number) {
  try {
    return parseTsv(await run(process.env.TESSERACT_PATH || "tesseract", [imagePath, "stdout", "-l", process.env.PDF_OCR_LANGUAGES || "deu+eng", "--dpi", String(dpi), "--psm", "3", "tsv"], 120_000), page);
  } catch {
    return parseTsv(await run(process.env.TESSERACT_PATH || "tesseract", [imagePath, "stdout", "-l", "deu", "--dpi", "100", "--psm", "6", "tsv"], 120_000), page);
  }
}

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
}

function parseNativeBbox(html: string): TsvWord[][] {
  const pages: TsvWord[][] = [];
  for (const pageMatch of html.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)) {
    const words: TsvWord[] = [];
    let lineNumber = 0;
    for (const lineMatch of pageMatch[1].matchAll(/<line\b[^>]*>([\s\S]*?)<\/line>/g)) {
      lineNumber += 1;
      for (const wordMatch of lineMatch[1].matchAll(/<word\s+xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)">([\s\S]*?)<\/word>/g)) {
        const [, xMin, yMin, xMax, yMax, text] = wordMatch;
        if (!decodeHtml(text).trim()) continue;
        words.push({ id: words.length, text: decodeHtml(text).trim(), line: `${pages.length + 1}:${lineNumber}`, left: Number(xMin), top: Number(yMin), width: Number(xMax) - Number(xMin), height: Number(yMax) - Number(yMin) });
      }
    }
    pages.push(words);
  }
  return pages;
}

function scaleNativeWords(words: TsvWord[], imageWidth: number, imageHeight: number, size: { width: number; height: number }) {
  return words.map((word) => ({ ...word, left: word.left / size.width * imageWidth, top: word.top / size.height * imageHeight, width: word.width / size.width * imageWidth, height: word.height / size.height * imageHeight }));
}

function pageSize(info: string) {
  const match = info.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m);
  if (!match) throw new Error("No page size found");
  return { width: Number(match[1]), height: Number(match[2]) };
}

function overlaySvg(width: number, height: number, words: TsvWord[], wordIds: Set<number>) {
  const padding = 5;
  const rectangles = words.filter((word) => wordIds.has(word.id)).map((word) => {
    const x = Math.max(0, word.left - padding);
    const y = Math.max(0, word.top - padding);
    const boxWidth = Math.min(width - x, word.width + padding * 2);
    const boxHeight = Math.min(height - y, word.height + padding * 2);
    return `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" fill="#000"/>`;
  }).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rectangles}</svg>`);
}

function fullyRedactedSvg(width: number, height: number) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#000"/></svg>`);
}

async function atomicWrite(file: string, bytes: Uint8Array | string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, bytes);
  await fs.rename(temporary, file);
}

async function anonymizePdf(input: string, output: string, dpi: number): Promise<PageReport[]> {
  const count = await pageCount(input);
  const size = pageSize(await run(process.env.PDFINFO_PATH || "pdfinfo", [input]));
  const nativePages = parseNativeBbox(await run(process.env.PDFTOTEXT_PATH || "pdftotext", ["-bbox-layout", input, "-"]));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "municipality-minute-redaction-"));
  try {
    const document = await PDFDocument.create();
    const reports: PageReport[] = [];
    for (let page = 1; page <= count; page += 1) {
      const prefix = path.join(temporary, `page-${page}`);
      await run(process.env.PDFTOPPM_PATH || "pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-r", String(dpi), "-png", input, prefix]);
      const imagePath = `${prefix}.png`;
      const metadata = await sharp(imagePath).metadata();
      if (!metadata.width || !metadata.height) throw new Error(`Unable to read rendered page ${page}`);
      const nativeWords = nativePages[page - 1] ?? [];
      const extractionMethod = nativeWords.length >= 8 ? "native" : "ocr";
      const fullyRedacted = extractionMethod === "ocr";
      const words = extractionMethod === "native"
        ? scaleNativeWords(nativeWords, metadata.width, metadata.height, size)
        : [];
      const matches = findRedactionMatches(words);
      const wordIds = new Set(matches.map((match) => match.wordId));
      const redacted = await sharp(imagePath).composite([{ input: fullyRedacted ? fullyRedactedSvg(metadata.width, metadata.height) : overlaySvg(metadata.width, metadata.height, words, wordIds) }]).png().toBuffer();
      const image = await document.embedPng(redacted);
      document.addPage([size.width, size.height]).drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
      const byReason: Partial<Record<RedactionReason, number>> = {};
      for (const match of matches) for (const reason of match.reasons) byReason[reason] = (byReason[reason] ?? 0) + 1;
      reports.push({ page, extractionMethod, fullyRedacted, redactions: fullyRedacted ? 1 : matches.length, byReason });
    }
    await atomicWrite(output, await document.save());
    return reports;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const options = optionsFromArgs(process.argv.slice(2));
  const allFiles = await listPdfs(options.source);
  const files = options.limit ? allFiles.slice(0, options.limit) : allFiles;
  const documents: Array<{ relativePath: string; pages: PageReport[]; totalRedactions: number }> = [];
  for (const [index, file] of files.entries()) {
    const relativePath = path.relative(options.source, file).split(path.sep).join("/");
    const output = path.join(options.output, relativePath);
    if (!options.force) {
      try { await fs.access(output); process.stdout.write(`[${index + 1}/${files.length}] Reused ${relativePath}\n`); continue; } catch { /* create below */ }
    }
    const pages = await anonymizePdf(file, output, options.dpi);
    documents.push({ relativePath, pages, totalRedactions: pages.reduce((total, page) => total + page.redactions, 0) });
    process.stdout.write(`[${index + 1}/${files.length}] ${relativePath}\n`);
  }
  await atomicWrite(path.join(options.output, "anonymization-report.json"), JSON.stringify({
    schemaVersion: 1, generatedAt: new Date().toISOString(), sourceDirectory: options.source, filesProcessed: files.length,
    notes: ["Pixel-based review copies: original PDF text is not embedded.", "Automatic redaction is heuristic and requires human review before sharing.", "Pages without reliable embedded text are fully blacked out and marked in the report."], documents,
  }, null, 2) + "\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
