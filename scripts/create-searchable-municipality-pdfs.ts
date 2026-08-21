import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";

const execFileAsync = promisify(execFile);

type Options = {
  source: string;
  output: string;
  force: boolean;
  limit: number | null;
  dpi: number;
  languages: string;
};

type FileResult = {
  source: string;
  output: string;
  status: "created" | "reused" | "incomplete" | "failed";
  pages: number;
  nativePages: number;
  ocrPages: number;
  fallbackPages: number;
  textCharacters: number;
  inputBytes: number;
  outputBytes: number;
  durationSeconds: number;
  errors: string[];
};

type Report = {
  schemaVersion: 1;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  source: string;
  output: string;
  settings: { dpi: number; languages: string };
  documents: FileResult[];
};

function optionValue(args: string[], key: string) {
  const position = args.indexOf(key);
  return position >= 0 ? args[position + 1] : undefined;
}

function optionsFromArgs(args: string[]): Options {
  const source = optionValue(args, "--source");
  const output = optionValue(args, "--output");
  const rawLimit = optionValue(args, "--limit");
  const rawDpi = optionValue(args, "--dpi");
  const limit = rawLimit === undefined ? null : Number(rawLimit);
  const dpi = rawDpi === undefined ? 150 : Number(rawDpi);

  if (!source || !output) {
    throw new Error("Usage: --source PATH --output PATH [--dpi 150] [--languages deu] [--limit N] [--force]");
  }
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  if (!Number.isInteger(dpi) || dpi < 100 || dpi > 300) {
    throw new Error("--dpi must be an integer between 100 and 300");
  }

  const resolvedSource = path.resolve(source);
  const resolvedOutput = path.resolve(output);
  const relativeOutput = path.relative(resolvedSource, resolvedOutput);
  if (
    resolvedSource === resolvedOutput ||
    (!relativeOutput.startsWith("..") && !path.isAbsolute(relativeOutput))
  ) {
    throw new Error("--output must be outside --source so generated PDFs are never read as input");
  }

  return {
    source: resolvedSource,
    output: resolvedOutput,
    force: args.includes("--force"),
    limit,
    dpi,
    languages: optionValue(args, "--languages") || "deu",
  };
}

async function run(
  command: string,
  args: string[],
  timeout = 120_000,
  env: NodeJS.ProcessEnv = process.env,
) {
  const result = await execFileAsync(command, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
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

function usefulLetterCount(text: string) {
  return text.match(/[A-Za-zÄÖÜäöüß]/g)?.length ?? 0;
}

async function nativePageText(file: string, page: number) {
  return run(
    process.env.PDFTOTEXT_PATH || "pdftotext",
    ["-f", String(page), "-l", String(page), "-layout", "-enc", "UTF-8", file, "-"],
    60_000,
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.replaceAll("\n", " ").slice(0, 500);
  return String(error).slice(0, 500);
}

async function ocrPage(
  source: string,
  page: number,
  options: Pick<Options, "dpi" | "languages">,
) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "municipality-pdf-ocr-"));
  const attempts = [
    { dpi: options.dpi, psm: "3" },
    { dpi: Math.max(100, Math.min(120, options.dpi)), psm: "6" },
  ];
  const errors: string[] = [];

  try {
    for (const [index, attempt] of attempts.entries()) {
      const imagePrefix = path.join(temporary, `page-${index}`);
      const imageFile = `${imagePrefix}.png`;
      const ocrPrefix = path.join(temporary, `ocr-${index}`);
      try {
        await run(
          process.env.PDFTOPPM_PATH || "pdftoppm",
          [
            "-f", String(page), "-l", String(page), "-singlefile",
            "-gray", "-r", String(attempt.dpi), "-png", source, imagePrefix,
          ],
          180_000,
        );
        await run(
          process.env.TESSERACT_PATH || "tesseract",
          [
            imageFile, ocrPrefix, "-l", options.languages,
            "--dpi", String(attempt.dpi), "--psm", attempt.psm, "pdf", "txt",
          ],
          360_000,
          { ...process.env, OMP_THREAD_LIMIT: process.env.OMP_THREAD_LIMIT || "2" },
        );
        return {
          pdf: await fs.readFile(`${ocrPrefix}.pdf`),
          text: await fs.readFile(`${ocrPrefix}.txt`, "utf8"),
          errors,
        };
      } catch (error) {
        errors.push(`attempt ${index + 1}: ${errorMessage(error)}`);
      }
    }
    throw new Error(errors.join("; "));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function existingPageCount(file: string) {
  try {
    const bytes = await fs.readFile(file);
    return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
  } catch {
    return null;
  }
}

async function atomicWrite(file: string, bytes: Uint8Array) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function convertPdf(source: string, output: string, relative: string, options: Options): Promise<FileResult> {
  const started = Date.now();
  const inputBytes = (await fs.stat(source)).size;
  const sourceBytes = await fs.readFile(source);
  const sourceDocument = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const pages = sourceDocument.getPageCount();

  if (!options.force && await existingPageCount(output) === pages) {
    return {
      source: relative, output: relative, status: "reused", pages,
      nativePages: 0, ocrPages: 0, fallbackPages: 0, textCharacters: 0,
      inputBytes, outputBytes: (await fs.stat(output)).size,
      durationSeconds: (Date.now() - started) / 1000, errors: [],
    };
  }

  const outputDocument = await PDFDocument.create();
  let nativePages = 0;
  let ocrPages = 0;
  let fallbackPages = 0;
  let textCharacters = 0;
  const errors: string[] = [];

  for (let page = 1; page <= pages; page += 1) {
    let text = "";
    try {
      text = await nativePageText(source, page);
    } catch (error) {
      errors.push(`page ${page} text check: ${errorMessage(error)}`);
    }
    textCharacters += text.length;

    if (usefulLetterCount(text) >= 80) {
      const [copied] = await outputDocument.copyPages(sourceDocument, [page - 1]);
      outputDocument.addPage(copied);
      nativePages += 1;
      continue;
    }

    try {
      const ocr = await ocrPage(source, page, options);
      const ocrDocument = await PDFDocument.load(ocr.pdf);
      const [copied] = await outputDocument.copyPages(ocrDocument, [0]);
      outputDocument.addPage(copied);
      textCharacters += ocr.text.length;
      ocrPages += 1;
      if (ocr.errors.length > 0) errors.push(`page ${page}: ${ocr.errors.join("; ")}`);
    } catch (error) {
      const [copied] = await outputDocument.copyPages(sourceDocument, [page - 1]);
      outputDocument.addPage(copied);
      fallbackPages += 1;
      errors.push(`page ${page} OCR: ${errorMessage(error)}`);
    }
  }

  const outputBytes = await outputDocument.save({ useObjectStreams: true });
  await atomicWrite(output, outputBytes);
  return {
    source: relative,
    output: relative,
    status: fallbackPages > 0 ? "incomplete" : "created",
    pages,
    nativePages,
    ocrPages,
    fallbackPages,
    textCharacters,
    inputBytes,
    outputBytes: outputBytes.length,
    durationSeconds: (Date.now() - started) / 1000,
    errors,
  };
}

async function writeReport(file: string, report: Report) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
  await fs.rename(temporary, file);
}

async function main() {
  const options = optionsFromArgs(process.argv.slice(2));
  const sourceStat = await fs.stat(options.source);
  if (!sourceStat.isDirectory()) throw new Error(`Source is not a directory: ${options.source}`);

  const allPdfs = await listPdfs(options.source);
  const pdfs = options.limit === null ? allPdfs : allPdfs.slice(0, options.limit);
  const reportFile = path.join(options.output, "ocr-report.json");
  const report: Report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    source: options.source,
    output: options.output,
    settings: { dpi: options.dpi, languages: options.languages },
    documents: [],
  };

  process.stdout.write(`Found ${allPdfs.length} PDFs; processing ${pdfs.length}.\n`);
  for (const [index, source] of pdfs.entries()) {
    const relative = path.relative(options.source, source);
    const output = path.join(options.output, relative);
    process.stdout.write(`[${index + 1}/${pdfs.length}] ${relative}\n`);
    try {
      const result = await convertPdf(source, output, relative, options);
      report.documents.push(result);
      process.stdout.write(
        `  ${result.status}: ${result.pages} pages (${result.nativePages} native, ${result.ocrPages} OCR, ${result.fallbackPages} fallback)\n`,
      );
    } catch (error) {
      report.documents.push({
        source: relative, output: relative, status: "failed", pages: 0,
        nativePages: 0, ocrPages: 0, fallbackPages: 0, textCharacters: 0,
        inputBytes: 0, outputBytes: 0, durationSeconds: 0,
        errors: [errorMessage(error)],
      });
      process.stderr.write(`  failed: ${errorMessage(error)}\n`);
    }
    report.updatedAt = new Date().toISOString();
    await writeReport(reportFile, report);
  }

  report.completedAt = new Date().toISOString();
  report.updatedAt = report.completedAt;
  await writeReport(reportFile, report);
  const incomplete = report.documents.filter((document) => document.status === "incomplete").length;
  const failed = report.documents.filter((document) => document.status === "failed").length;
  process.stdout.write(`Done: ${report.documents.length} PDFs, ${incomplete} incomplete, ${failed} failed.\n`);
  if (incomplete > 0 || failed > 0) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
});
