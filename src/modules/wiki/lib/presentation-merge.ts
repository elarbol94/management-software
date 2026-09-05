import type { PresentationSnapshot } from "./presentation";

export function presentationValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => presentationValuesEqual(value, b[i]));
  if (object(a) && object(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) => presentationValuesEqual(a[key], b[key]));
  return false;
}
const equal = presentationValuesEqual;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Three-way merge: independent fields merge; competing edits are explicit conflicts. */
export function mergePresentation(base: PresentationSnapshot, local: PresentationSnapshot, remote: PresentationSnapshot) {
  const conflicts: string[] = [];
  function merge(before: unknown, ours: unknown, theirs: unknown, path: string): unknown {
    if (equal(ours, before)) return theirs;
    if (equal(theirs, before) || equal(ours, theirs)) return ours;
    if (object(before) && object(ours) && object(theirs)) {
      return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(ours), ...Object.keys(theirs)])].map((key) => [key, merge(before[key], ours[key], theirs[key], `${path}.${key}`)]));
    }
    conflicts.push(path); return ours;
  }
  function collection(key: "elements" | "steps") {
    const before = new Map(base[key].map((item) => [item.id, item]));
    const ours = new Map(local[key].map((item) => [item.id, item]));
    const theirs = new Map(remote[key].map((item) => [item.id, item]));
    const shared = new Set(base[key].filter((item) => ours.has(item.id) && theirs.has(item.id)).map((item) => item.id));
    const order = (snapshot: PresentationSnapshot) => snapshot[key].filter((item) => shared.has(item.id)).map((item) => item.id);
    const mergedOrder = merge(order(base), order(local), order(remote), `${key}.order`) as string[];
    // Preserve insertions next to their predecessor, including concurrent disjoint insertions.
    const ids = [...mergedOrder];
    for (const source of [remote[key], local[key]]) source.forEach((item, index) => {
      if (ids.includes(item.id)) return;
      const previous = source.slice(0, index).findLast((entry) => ids.includes(entry.id));
      ids.splice(previous ? ids.indexOf(previous.id) + 1 : 0, 0, item.id);
    });
    for (const id of before.keys()) if (!ids.includes(id)) ids.push(id);
    return ids.map((id) => merge(before.get(id), ours.get(id), theirs.get(id), `${key}.${id}`)).filter((item) => item !== undefined);
  }
  const snapshot = {
    elements: collection("elements"), steps: collection("steps"),
    title: merge(base.title, local.title, remote.title, "title"),
    background: merge(base.background, local.background, remote.background, "background"),
    settings: merge(base.settings, local.settings, remote.settings, "settings"),
  } as PresentationSnapshot;
  return { snapshot, conflicts };
}
