// Tag lists arrive from SQL as group_concat("id:name") — tag ids never contain a colon,
// and tag names never contain a comma because they are split on commas when they are entered.
export type TagRef = { id: string; name: string };

export function parseTagList(tags: string | null): TagRef[] {
  return (tags ?? "")
    .split(",")
    .map((entry) => {
      const separator = entry.indexOf(":");
      return separator < 1 ? null : { id: entry.slice(0, separator), name: entry.slice(separator + 1) };
    })
    .filter((tag): tag is TagRef => Boolean(tag?.name));
}
