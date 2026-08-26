"use client";

import { parseSearchSnippet } from "../lib/search-snippet";

/** Renders an FTS5 snippet(), highlighting the <mark> ranges it embeds. */
export function SearchSnippet({ value }: { value: string }) {
  return parseSearchSnippet(value).map((segment, index) => segment.highlighted
    ? <mark key={index} className="rounded-sm bg-amber-200 px-0.5 text-foreground dark:bg-amber-800/70">{segment.text}</mark>
    : <span key={index}>{segment.text}</span>);
}
