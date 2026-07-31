import { DOMParser, type Element } from "@xmldom/xmldom";

export type SvgTextLayer = {
  id: string;
  text: string;
  binding: string;
  /** Label geometry in the drawing's own user units; null when the element carries none. */
  fontSize: number | null;
  x: number | null;
  y: number | null;
};

/** Reads a single-value geometry attribute; lists ("10 20 30") are left alone. */
export function readSvgNumber(element: Element, name: string) {
  const value = element.getAttribute(name);
  if (!value || /[\s,]/.test(value.trim())) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Writes a geometry attribute only where it actually differs, so a save that
 * changed nothing leaves the markup — and with it the version — untouched.
 */
export function writeSvgNumber(element: Element, name: string, value: number | null) {
  if (value === null) return;
  const current = readSvgNumber(element, name);
  if (current === null || Math.abs(current - value) < 0.0005) return;
  element.setAttribute(name, String(Math.round(value * 100) / 100));
}

const TEXT_NODE = 3;

export function parseSvgBindings(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

/**
 * The text an element owns itself, ignoring what its children hold. For a plain
 * label that is simply its content; for `<text>4.025<tspan> €/Monat</tspan></text>`
 * it is the headline number, so that number stays editable while the unit keeps
 * its own smaller styling.
 */
export function ownSvgText(element: Element) {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === TEXT_NODE)
    .map((node) => node.nodeValue ?? "")
    .join("");
}

/** Rewrites what the element owns, leaving its child elements in place. */
export function setOwnSvgText(element: Element, value: string) {
  const owned = Array.from(element.childNodes).filter((node) => node.nodeType === TEXT_NODE);
  // Where the text sat, so a rewritten "4.025" stays in front of its unit tspan.
  let anchor = owned[0]?.nextSibling ?? null;
  while (anchor && anchor.nodeType === TEXT_NODE) anchor = anchor.nextSibling;
  for (const node of owned) element.removeChild(node);
  // An empty text node is not the same as no children to the serializer
  // (`<tspan></tspan>` vs `<tspan/>`), which would make a no-op save look like a change.
  if (!value) return;
  const text = element.ownerDocument!.createTextNode(value);
  if (anchor) element.insertBefore(text, anchor);
  else element.appendChild(text);
}

/**
 * A labelled element is editable when it either holds nothing but text, or owns
 * text of its own next to its children. One that only wraps tspans is not — its
 * children carry their own labels.
 */
export function isEditableSvgText(element: Element, text = ownSvgText(element)) {
  return Boolean(text) || element.getElementsByTagName("tspan").length === 0;
}

export function extractSvgTextLayers(svg: string, bindingsJson = "{}"): SvgTextLayer[] {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const bindings = parseSvgBindings(bindingsJson);
  return [
    ...Array.from(document.getElementsByTagName("text")),
    ...Array.from(document.getElementsByTagName("tspan")),
  ].flatMap((element) => {
    const id = element.getAttribute("data-wiki-text-id");
    if (!id) return [];
    const text = ownSvgText(element);
    if (!isEditableSvgText(element, text)) return [];
    return [{
      id,
      text,
      binding: bindings[id] ?? "",
      fontSize: readSvgNumber(element, "font-size"),
      x: readSvgNumber(element, "x"),
      y: readSvgNumber(element, "y"),
    }];
  });
}
