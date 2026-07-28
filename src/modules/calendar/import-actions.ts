"use server";

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { z } from "zod";
import { requireUserOrThrow } from "@/lib/auth";
import {
  parseCalendarImport,
  type CalendarImportSuggestion,
} from "./import-parser";

const MAX_TEXT_LENGTH = 250_000;
const MAX_URL_BYTES = 1_500_000;

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  ) {
    return true;
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

async function assertPublicUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported");
  }
  if (url.username || url.password) {
    throw new Error("URLs with credentials are not supported");
  }
  if (
    url.hostname === "localhost" ||
    url.hostname.endsWith(".local") ||
    (isIP(url.hostname) && isPrivateAddress(url.hostname))
  ) {
    throw new Error("Private network URLs are not supported");
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Private network URLs are not supported");
  }
  return url;
}

async function readLimitedBody(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_URL_BYTES) {
    throw new Error("The linked page is too large");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_URL_BYTES) {
      await reader.cancel();
      throw new Error("The linked page is too large");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function fetchPublicPage(value: string) {
  let url = await assertPublicUrl(value);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "text/html,text/calendar,text/plain;q=0.9,*/*;q=0.2",
        "User-Agent": "management-platform-calendar-import/1.0",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw new Error("Too many redirects");
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`The linked page returned ${response.status}`);
    return {
      body: await readLimitedBody(response),
      contentType: response.headers.get("content-type") ?? "",
      finalUrl: url.toString(),
    };
  }
  throw new Error("The linked page could not be loaded");
}

function decodeHtml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractHtml(html: string) {
  const jsonLd: unknown[] = [];
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      jsonLd.push(JSON.parse(match[1]));
    } catch {
      // Ignore malformed metadata and continue with the visible page.
    }
  }
  const metaTitle =
    html.match(
      /<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    )?.[1] ??
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]*>/i,
    )?.[1] ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const text = decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    text: text.slice(0, MAX_TEXT_LENGTH),
    title: metaTitle ? decodeHtml(metaTitle).trim() : undefined,
    jsonLd,
  };
}

export async function analyzeCalendarText(input: {
  text: string;
  fileName?: string;
}): Promise<CalendarImportSuggestion> {
  await requireUserOrThrow();
  const data = z
    .object({
      text: z.string().min(1).max(MAX_TEXT_LENGTH),
      fileName: z.string().max(240).optional(),
    })
    .parse(input);
  return parseCalendarImport(data.text);
}

export async function analyzeCalendarUrl(input: {
  url: string;
}): Promise<CalendarImportSuggestion> {
  await requireUserOrThrow();
  const data = z.object({ url: z.string().url().max(2_000) }).parse(input);
  const result = await fetchPublicPage(data.url);
  if (/text\/calendar/i.test(result.contentType) || /BEGIN:VEVENT/i.test(result.body)) {
    return parseCalendarImport(result.body, { sourceUrl: result.finalUrl });
  }
  const html = extractHtml(result.body);
  return parseCalendarImport(html.text, {
    titleHint: html.title,
    jsonLd: html.jsonLd,
    sourceUrl: result.finalUrl,
  });
}
