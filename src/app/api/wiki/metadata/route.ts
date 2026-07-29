import dns from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import net from "node:net";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { normalizeDoi, normalizeIsbn, normalizeUrl } from "@/modules/wiki/lib/citations";

const lookupSchema = z.object({
  kind: z.enum(["doi", "isbn", "url"]),
  value: z.string().trim().min(1).max(2_000),
  accessedAt: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime())
        && date.toISOString().slice(0, 10) === value;
    })
    .optional(),
});

function privateAddress(address: string) {
  if (net.isIPv4(address)) {
    const value = address.split(".").map(Number).reduce((result, part) => ((result << 8) | part) >>> 0, 0);
    const inCidr = (base: number, bits: number) => (value >>> (32 - bits)) === (base >>> (32 - bits));
    return inCidr(0x00000000, 8)
      || inCidr(0x0a000000, 8)
      || inCidr(0x64400000, 10)
      || inCidr(0x7f000000, 8)
      || inCidr(0xa9fe0000, 16)
      || inCidr(0xac100000, 12)
      || inCidr(0xc0000000, 24)
      || inCidr(0xc0000200, 24)
      || inCidr(0xc0a80000, 16)
      || inCidr(0xc6120000, 15)
      || inCidr(0xc6336400, 24)
      || inCidr(0xcb007100, 24)
      || inCidr(0xe0000000, 4)
      || inCidr(0xf0000000, 4);
  }
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    if (net.isIPv4(mapped)) return privateAddress(mapped);
    const parts = mapped.split(":");
    if (parts.length === 2 && parts.every((part) => /^[\da-f]{1,4}$/.test(part))) {
      const high = Number.parseInt(parts[0], 16);
      const low = Number.parseInt(parts[1], 16);
      return privateAddress(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
    }
  }
  if (normalized.startsWith("::")) {
    const compatible = normalized.slice(2);
    const parts = compatible.split(":").filter(Boolean);
    if (net.isIPv4(compatible) || (parts.length <= 2 && parts.every((part) => /^[\da-f]{1,4}$/.test(part)))) {
      return true;
    }
  }
  const first = Number.parseInt(normalized.split(":").find(Boolean) ?? "0", 16);
  return normalized === "::"
    || normalized === "::1"
    || (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfe80
    || (first & 0xffc0) === 0xfec0
    || (first & 0xff00) === 0xff00;
}

type PublicUrl = {
  url: URL;
  hostname: string;
  address: string;
  family: number;
};

async function assertPublicUrl(value: string): Promise<PublicUrl> {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only HTTP(S) URLs are supported");
  if (url.username || url.password) throw new Error("URLs with credentials are not supported");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) throw new Error("Private network URLs are not allowed");
  return {
    url,
    hostname,
    address: addresses[0].address,
    family: addresses[0].family,
  };
}

const MAX_HTML_BYTES = 1_000_000;

function fetchPinnedHtml(target: PublicUrl) {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, html?: string) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(html ?? "");
    };
    const lookup: net.LookupFunction = (hostname, options, callback) => {
      if (hostname !== target.hostname) {
        callback(new Error("Unexpected lookup target"), "", 0);
        return;
      }
      if (options.all) {
        callback(null, [{ address: target.address, family: target.family }]);
        return;
      }
      callback(null, target.address, target.family);
    };
    const request = (target.url.protocol === "https:" ? httpsRequest : httpRequest)(
      target.url,
      {
        headers: { "User-Agent": "CompanyHQ/0.1" },
        lookup,
        signal: AbortSignal.timeout(8_000),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          finish(new Error("Redirected URLs must be entered directly"));
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          finish(new Error("URL metadata could not be loaded"));
          return;
        }
        const contentType = String(response.headers["content-type"] ?? "");
        if (!contentType.includes("text/html")) {
          response.resume();
          finish(new Error("URL does not point to an HTML page"));
          return;
        }
        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
          response.resume();
          finish(new Error("HTML page is too large"));
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          size += chunk.length;
          if (size > MAX_HTML_BYTES) {
            response.destroy();
            finish(new Error("HTML page is too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          finish(undefined, Buffer.concat(chunks, size).toString("utf8"));
        });
        response.on("error", (error) => finish(error));
      },
    );
    request.on("error", (error) => finish(error));
    request.end();
  });
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
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = lookupSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid metadata lookup" }, { status: 400 });
  }
  const { kind, value, accessedAt } = parsed.data;
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
    const target = await assertPublicUrl(normalizeUrl(value)); const html = await fetchPinnedHtml(target); const title = meta(html, "og:title") || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
    return NextResponse.json({ type: "webPage", title: decode(title.trim()), abstract: decode(meta(html, "description") || meta(html, "og:description")), issuedDate: meta(html, "article:published_time").slice(0, 10), publisher: decode(meta(html, "og:site_name")), url: target.url.toString(), accessedAt: accessedAt ?? new Date().toISOString().slice(0, 10), contributors: [] });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Lookup failed" }, { status: 400 }); }
}
