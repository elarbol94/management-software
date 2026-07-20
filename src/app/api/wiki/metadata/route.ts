import dns from "node:dns/promises";
import net from "node:net";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { normalizeDoi, normalizeIsbn, normalizeUrl } from "@/modules/wiki/lib/citations";

function privateAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:");
}

async function assertPublicUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only HTTP(S) URLs are supported");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) throw new Error("Private network URLs are not allowed");
  return url;
}

function meta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  return patterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean) ?? "";
}

function decode(value: string) { return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">"); }

export async function POST(request: Request) {
  if (!await getSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { kind, value } = await request.json() as { kind: "doi" | "isbn" | "url"; value: string };
  try {
    if (kind === "doi") {
      const doi = normalizeDoi(value); const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "CompanyHQ/0.1 (metadata lookup)" } });
      if (!response.ok) throw new Error("DOI metadata was not found"); const item = (await response.json()).message;
      return NextResponse.json({ type: item.type === "journal-article" ? "journalArticle" : item.type === "book-chapter" ? "bookChapter" : item.type === "book" ? "book" : "document", title: item.title?.[0] ?? "", subtitle: item.subtitle?.[0] ?? "", issuedDate: item.issued?.["date-parts"]?.[0]?.join("-") ?? "", containerTitle: item["container-title"]?.[0] ?? "", publisher: item.publisher ?? "", volume: item.volume ?? "", issue: item.issue ?? "", pages: item.page ?? "", doi, url: item.URL ?? "", contributors: (item.author ?? []).map((person: { given?: string; family?: string }) => ({ role: "author", given: person.given ?? "", family: person.family ?? "", literal: "" })) });
    }
    if (kind === "isbn") {
      const isbn = normalizeIsbn(value); const response = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`, { signal: AbortSignal.timeout(8_000) }); if (!response.ok) throw new Error("ISBN metadata was not found"); const body = await response.json(); const item = body[`ISBN:${isbn}`]; if (!item) throw new Error("ISBN metadata was not found");
      return NextResponse.json({ type: "book", title: item.title ?? "", subtitle: item.subtitle ?? "", issuedDate: String(item.publish_date ?? ""), publisher: item.publishers?.[0]?.name ?? "", isbn, url: item.url ? `https://openlibrary.org${item.url}` : "", contributors: (item.authors ?? []).map((person: { name?: string }) => ({ role: "author", given: "", family: "", literal: person.name ?? "" })) });
    }
    const url = await assertPublicUrl(normalizeUrl(value)); const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "CompanyHQ/0.1" } }); if (response.status >= 300 && response.status < 400) throw new Error("Redirected URLs must be entered directly"); if (!response.ok) throw new Error("URL metadata could not be loaded"); if (!(response.headers.get("content-type") ?? "").includes("text/html")) throw new Error("URL does not point to an HTML page"); const html = (await response.text()).slice(0, 1_000_000); const title = meta(html, "og:title") || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
    return NextResponse.json({ type: "webPage", title: decode(title.trim()), abstract: decode(meta(html, "description") || meta(html, "og:description")), issuedDate: meta(html, "article:published_time").slice(0, 10), publisher: decode(meta(html, "og:site_name")), url: url.toString(), accessedAt: new Date().toISOString().slice(0, 10), contributors: [] });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Lookup failed" }, { status: 400 }); }
}
