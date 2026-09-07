import { z } from "zod";

const positionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("presentation"), id: z.string(), viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().min(0.02).max(8) }), selectedIds: z.array(z.string()).max(500), activeStepId: z.string().nullable() }),
  z.object({ kind: z.literal("document"), id: z.string(), slug: z.string(), sectionId: z.string(), from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), scroll: z.array(z.number().finite().nonnegative()).max(30) }),
]);
export type LinkedPosition = z.infer<typeof positionSchema>;
const key = (token: string) => `wiki-linked-navigation:${token}`;

/** Per-tab storage holds only navigation state, never document text or auth data. */
export function rememberLinkedPosition(position: LinkedPosition): string | undefined {
  try {
    const token = crypto.randomUUID();
    // Bound the journal for long sessions.
    const keys = Object.keys(sessionStorage).filter((item) => item.startsWith("wiki-linked-navigation:"));
    for (const item of keys.slice(0, Math.max(0, keys.length - 39))) sessionStorage.removeItem(item);
    sessionStorage.setItem(key(token), JSON.stringify(position));
    return token;
  } catch { return undefined; }
}

export function readLinkedPosition(token: string | null | undefined): LinkedPosition | null {
  if (!token || token.length > 64) return null;
  try { return positionSchema.parse(JSON.parse(sessionStorage.getItem(key(token)) ?? "null")); }
  catch { return null; }
}

export function documentScrollContainers(element: HTMLElement): HTMLElement[] {
  const containers: HTMLElement[] = [];
  let current: HTMLElement | null = element.parentElement;
  while (current) { containers.push(current); current = current.parentElement; }
  return containers;
}
