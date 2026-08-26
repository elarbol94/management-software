import { diffArrays, diffWordsWithSpace } from "diff";

export type DiffKind = "unchanged" | "removed" | "added" | "empty";

export type WordPart = {
  text: string;
  changed: boolean;
};

export type DiffCell = {
  lineNumber: number | null;
  kind: DiffKind;
  text: string;
  parts: WordPart[];
};

export type RevisionDiffRow = {
  old: DiffCell;
  current: DiffCell;
};

function splitLines(value: string): string[] {
  if (!value) return [""];
  return value.replace(/\r\n?/g, "\n").split("\n");
}

function wordParts(oldText: string, currentText: string) {
  const changes = diffWordsWithSpace(oldText, currentText);
  return {
    old: changes
      .filter((change) => !change.added)
      .map((change) => ({ text: change.value, changed: Boolean(change.removed) })),
    current: changes
      .filter((change) => !change.removed)
      .map((change) => ({ text: change.value, changed: Boolean(change.added) })),
  };
}

function cell(lineNumber: number | null, kind: DiffKind, text = "", parts?: WordPart[]): DiffCell {
  return { lineNumber, kind, text, parts: parts ?? [{ text, changed: false }] };
}

export function buildRevisionDiff(oldText: string, currentText: string): RevisionDiffRow[] {
  const changes = diffArrays(splitLines(oldText), splitLines(currentText));
  const rows: RevisionDiffRow[] = [];
  let oldLine = 1;
  let currentLine = 1;

  for (let index = 0; index < changes.length;) {
    const change = changes[index];
    if (!change.added && !change.removed) {
      for (const text of change.value) {
        rows.push({
          old: cell(oldLine++, "unchanged", text),
          current: cell(currentLine++, "unchanged", text),
        });
      }
      index += 1;
      continue;
    }

    const removed: string[] = [];
    const added: string[] = [];
    while (index < changes.length && (changes[index].added || changes[index].removed)) {
      const changed = changes[index];
      if (changed.removed) removed.push(...changed.value);
      if (changed.added) added.push(...changed.value);
      index += 1;
    }

    const length = Math.max(removed.length, added.length);
    for (let offset = 0; offset < length; offset += 1) {
      const oldValue = removed[offset];
      const currentValue = added[offset];
      const parts = oldValue !== undefined && currentValue !== undefined
        ? wordParts(oldValue, currentValue)
        : null;
      rows.push({
        old: oldValue === undefined
          ? cell(null, "empty")
          : cell(oldLine++, "removed", oldValue, parts?.old),
        current: currentValue === undefined
          ? cell(null, "empty")
          : cell(currentLine++, "added", currentValue, parts?.current),
      });
    }
  }

  return rows;
}


export type SettingsChange = { path: string; from: string; to: string };

function flattenJson(value: unknown, prefix = "", out: Record<string, string> = {}) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    // Arrays compare as a whole: an index-wise diff of, say, header tokens reads worse
    // than "header.left: Titel -> Projekt".
    out[prefix] = JSON.stringify(value);
    return out;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      flattenJson(item, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out[prefix] = String(value);
  return out;
}

/**
 * Changes the text diff cannot show. extractText() drops layout, so page size, margins,
 * indices and document mode all changed invisibly even though pageSnapshotHash counted
 * them. Compares the parsed settings of two revisions and names each difference.
 */
export function diffDocumentSettings(oldJson: string, newJson: string): SettingsChange[] {
  const parse = (json: string) => {
    if (!json.trim()) return {};
    try { return JSON.parse(json) as unknown; } catch { return {}; }
  };
  const before = flattenJson(parse(oldJson));
  const after = flattenJson(parse(newJson));
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return paths
    .filter((path) => (before[path] ?? "") !== (after[path] ?? ""))
    .map((path) => ({ path, from: before[path] ?? "", to: after[path] ?? "" }));
}
