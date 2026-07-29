import { DOMParser } from "@xmldom/xmldom";

export type SvgTextLayer = {
  id: string;
  text: string;
  binding: string;
};

export function parseSvgBindings(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

export function extractSvgTextLayers(svg: string, bindingsJson = "{}"): SvgTextLayer[] {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const bindings = parseSvgBindings(bindingsJson);
  return [
    ...Array.from(document.getElementsByTagName("text")),
    ...Array.from(document.getElementsByTagName("tspan")),
  ]
    .filter((element) => element.getElementsByTagName("tspan").length === 0)
    .flatMap((element) => {
      const id = element.getAttribute("data-wiki-text-id");
      if (!id) return [];
      return [{ id, text: element.textContent ?? "", binding: bindings[id] ?? "" }];
    });
}
