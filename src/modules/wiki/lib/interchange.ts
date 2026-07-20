import type { z } from "zod";
import type { sourceInputSchema } from "../research-actions";
export type ImportedSource = z.infer<typeof sourceInputSchema>;
const empty = { subtitle: "", containerTitle: "", publisher: "", institution: "", edition: "", volume: "", issue: "", pages: "", doi: "", isbn: "", url: "", accessedAt: "", language: "", abstract: "", notes: "", readingStatus: "toRead" as const, tagNames: [] as string[] };
function person(name: string) { const [family, ...given] = name.split(","); return { role: "author" as const, family: family.trim(), given: given.join(",").trim(), literal: "" }; }
export function parseBibTeX(input: string): ImportedSource[] { const records: ImportedSource[] = []; const regex = /@(\w+)\s*\{[^,]*,([\s\S]*?)\n\}/g; for (const match of input.matchAll(regex)) { const fields: Record<string,string> = {}; for (const field of match[2].matchAll(/(\w+)\s*=\s*[{"]([\s\S]*?)[}"]\s*,?/g)) fields[field[1].toLowerCase()] = field[2].replace(/[{}]/g, "").trim(); const kind = match[1].toLowerCase(); records.push({ ...empty, type: kind.includes("article") ? "journalArticle" : kind.includes("inbook") ? "bookChapter" : kind.includes("book") ? "book" : kind.includes("report") ? "report" : "document", title: fields.title || "Untitled source", issuedDate: fields.year || "", containerTitle: fields.journal || fields.booktitle || "", publisher: fields.publisher || "", volume: fields.volume || "", issue: fields.number || "", pages: fields.pages || "", doi: fields.doi || "", isbn: fields.isbn || "", url: fields.url || "", contributors: (fields.author || "").split(/\s+and\s+/i).filter(Boolean).map(person) }); } return records; }
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
