import type { z } from "zod";
import type { sourceInputSchema } from "./source-input";
export type ImportedSource = z.infer<typeof sourceInputSchema>;
const empty = { documentType: "", subtitle: "", containerTitle: "", publisher: "", institution: "", edition: "", volume: "", issue: "", pages: "", doi: "", isbn: "", url: "", accessedAt: "", language: "", abstract: "", notes: "", readingStatus: "toRead" as const, tagNames: [] as string[] };
function person(name: string) {
  const normalized = name.trim();
  if (normalized.includes(",")) {
    const [family, ...given] = normalized.split(",");
    return { role: "author" as const, family: family.trim(), given: given.join(",").trim(), literal: "" };
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  const family = parts.pop() ?? "";
  return { role: "author" as const, family, given: parts.join(" "), literal: "" };
}

function readDelimitedValue(input: string, start: number) {
  const opening = input[start];
  if (opening !== "{" && opening !== "\"") {
    const end = input.indexOf(",", start);
    return {
      value: input.slice(start, end === -1 ? input.length : end).trim(),
      next: end === -1 ? input.length : end + 1,
    };
  }

  if (opening === "\"") {
    let escaped = false;
    for (let index = start + 1; index < input.length; index += 1) {
      const character = input[index];
      if (character === "\"" && !escaped) {
        return { value: input.slice(start + 1, index), next: index + 1 };
      }
      escaped = character === "\\" && !escaped;
      if (character !== "\\") escaped = false;
    }
    return { value: input.slice(start + 1), next: input.length };
  }

  let depth = 1;
  for (let index = start + 1; index < input.length; index += 1) {
    if (input[index] === "{") depth += 1;
    if (input[index] === "}") depth -= 1;
    if (depth === 0) {
      return { value: input.slice(start + 1, index), next: index + 1 };
    }
  }
  return { value: input.slice(start + 1), next: input.length };
}

function parseBibFields(input: string) {
  const fields: Record<string, string> = {};
  let cursor = input.indexOf(",") + 1;
  while (cursor > 0 && cursor < input.length) {
    while (/[\s,]/.test(input[cursor] ?? "")) cursor += 1;
    const key = input.slice(cursor).match(/^([\w-]+)\s*=/);
    if (!key) break;
    cursor += key[0].length;
    while (/\s/.test(input[cursor] ?? "")) cursor += 1;
    const parsed = readDelimitedValue(input, cursor);
    fields[key[1].toLowerCase()] = parsed.value.replace(/[{}]/g, "").trim();
    cursor = parsed.next;
  }
  return fields;
}

export function parseBibTeX(input: string): ImportedSource[] {
  const records: ImportedSource[] = [];
  const entryStart = /@(\w+)\s*([({])/g;
  for (let start = entryStart.exec(input); start; start = entryStart.exec(input)) {
    const opening = start[2];
    const closing = opening === "{" ? "}" : ")";
    const bodyStart = entryStart.lastIndex;
    let depth = 1;
    let quoted = false;
    let escaped = false;
    let bodyEnd = -1;
    for (let index = bodyStart; index < input.length; index += 1) {
      const character = input[index];
      if (character === "\"" && !escaped) quoted = !quoted;
      if (!quoted) {
        if (character === opening) depth += 1;
        if (character === closing) depth -= 1;
      }
      if (depth === 0) {
        bodyEnd = index;
        entryStart.lastIndex = index + 1;
        break;
      }
      escaped = character === "\\" && !escaped;
      if (character !== "\\") escaped = false;
    }
    if (bodyEnd === -1) break;
    const kind = start[1].toLowerCase();
    if (["comment", "preamble", "string"].includes(kind)) continue;
    const fields = parseBibFields(input.slice(bodyStart, bodyEnd));
    records.push({ ...empty, type: kind.includes("article") ? "journalArticle" : kind.includes("inbook") ? "bookChapter" : kind.includes("book") ? "book" : kind.includes("report") ? "report" : "document", title: fields.title || "Untitled source", issuedDate: fields.year || "", containerTitle: fields.journal || fields.booktitle || "", publisher: fields.publisher || "", volume: fields.volume || "", issue: fields.number || "", pages: fields.pages || "", doi: fields.doi || "", isbn: fields.isbn || "", url: fields.url || "", contributors: (fields.author || "").split(/\s+and\s+/i).filter(Boolean).map(person) });
  }
  return records;
}
export function parseRis(input: string): ImportedSource[] {
  const records: ImportedSource[] = [];
  for (const block of input.split(/\r?\nER\s*-\s*/)) {
    const fields = new Map<string, string[]>();
    for (const line of block.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9]{2})\s*-\s*(.*)$/);
      if (match) fields.set(match[1], [...(fields.get(match[1]) ?? []), match[2].trim()]);
    }
    const title = fields.get("TI")?.[0] || fields.get("T1")?.[0];
    if (!title) continue;
    const ty = fields.get("TY")?.[0];
    const type: ImportedSource["type"] = ty === "JOUR" ? "journalArticle" : ty === "BOOK" ? "book" : ty === "CHAP" ? "bookChapter" : ty === "RPRT" ? "report" : ty === "ELEC" ? "webPage" : "document";
    records.push({ ...empty, type, title, issuedDate: fields.get("PY")?.[0] || fields.get("Y1")?.[0] || "", containerTitle: fields.get("JO")?.[0] || fields.get("T2")?.[0] || "", publisher: fields.get("PB")?.[0] || "", volume: fields.get("VL")?.[0] || "", issue: fields.get("IS")?.[0] || "", pages: [fields.get("SP")?.[0], fields.get("EP")?.[0]].filter(Boolean).join("-"), doi: fields.get("DO")?.[0] || "", isbn: fields.get("SN")?.[0] || "", url: fields.get("UR")?.[0] || "", abstract: fields.get("AB")?.[0] || "", notes: fields.get("N1")?.join("\n") || "", contributors: (fields.get("AU") ?? []).map(person) });
  }
  return records;
}
export function toBibTeX(source: { id:string; type:string; title:string; issuedDate:string; containerTitle:string; publisher:string; volume:string; issue:string; pages:string; doi:string; isbn:string; url:string; contributors:Array<{given:string;family:string;literal:string}> }) { const type = source.type === "journalArticle" ? "article" : source.type === "book" ? "book" : source.type === "bookChapter" ? "inbook" : "misc"; const authors = source.contributors.map((item) => item.literal || `${item.family}, ${item.given}`).join(" and "); const fields = [["title",source.title],["author",authors],["year",source.issuedDate.slice(0,4)],["journal",source.containerTitle],["publisher",source.publisher],["volume",source.volume],["number",source.issue],["pages",source.pages],["doi",source.doi],["isbn",source.isbn],["url",source.url]].filter(([,value]) => value); return `@${type}{${source.id},\n${fields.map(([key,value]) => `  ${key} = {${value}}`).join(",\n")}\n}`; }
export function toRis(source: Parameters<typeof toBibTeX>[0]) { const ty = source.type === "journalArticle" ? "JOUR" : source.type === "book" ? "BOOK" : source.type === "bookChapter" ? "CHAP" : "GEN"; return [`TY  - ${ty}`,`TI  - ${source.title}`,...source.contributors.map((item) => `AU  - ${item.literal || `${item.family}, ${item.given}`}`),source.issuedDate && `PY  - ${source.issuedDate}`,source.containerTitle && `JO  - ${source.containerTitle}`,source.publisher && `PB  - ${source.publisher}`,source.doi && `DO  - ${source.doi}`,source.isbn && `SN  - ${source.isbn}`,source.url && `UR  - ${source.url}`,"ER  -"].filter(Boolean).join("\n"); }
