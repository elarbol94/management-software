export type SearchSnippetSegment = {
  text: string;
  highlighted: boolean;
};

/**
 * SQLite FTS snippets contain `<mark>` delimiters. Keep those delimiters as
 * presentation metadata while leaving every other character as plain text so
 * user-authored document content can never become executable HTML.
 */
export function parseSearchSnippet(value: string): SearchSnippetSegment[] {
  const segments: SearchSnippetSegment[] = [];
  let highlighted = false;

  for (const token of value.split(/(<mark>|<\/mark>)/gi)) {
    if (!token) continue;
    if (/^<mark>$/i.test(token)) {
      highlighted = true;
      continue;
    }
    if (/^<\/mark>$/i.test(token)) {
      highlighted = false;
      continue;
    }
    segments.push({ text: token, highlighted });
  }

  return segments;
}
