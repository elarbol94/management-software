import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { isSafeInlineSvg } from "@/lib/svg-upload";

/** Matplotlib writes an external SVG doctype and simple CSS rules. Inline those without resolving anything. */
export function normalizeFigureSvg(input: string) {
  if (/<!entity\b|<!doctype[^>]*\[/i.test(input)) throw new Error("invalidFile");
  const source = input.replace(/<!doctype\s+svg\s+(?:PUBLIC|SYSTEM)\s+[^>]*>/gi, "");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const elements = Array.from(document.getElementsByTagName("*"));
  const rules: Array<{ selector: string; declarations: string; specificity: number }> = [];
  for (const style of Array.from(document.getElementsByTagName("style"))) {
    const css = (style.textContent || "").replace(/\/\*[\s\S]*?\*\//g, "");
    const pattern = /([^{}]+)\{([^{}]*)\}/g;
    if (css.replace(pattern, "").trim()) throw new Error("invalidFile");
    for (const match of css.matchAll(pattern)) {
      for (const selector of match[1].split(",").map((item) => item.trim())) {
        if (!/^(?:\*|[a-z][\w-]*|[.#][\w-]+)$/i.test(selector)) throw new Error("invalidFile");
        rules.push({ selector, declarations: match[2], specificity: selector.startsWith("#") ? 100 : selector.startsWith(".") ? 10 : selector === "*" ? 0 : 1 });
      }
    }
    style.parentNode?.removeChild(style);
  }
  rules.sort((left, right) => left.specificity - right.specificity);
  for (const element of elements) {
    const matches = rules.filter(({ selector }) => selector === "*" || selector === element.tagName || (selector.startsWith("#") && element.getAttribute("id") === selector.slice(1)) || (selector.startsWith(".") && (element.getAttribute("class") || "").split(/\s+/).includes(selector.slice(1))));
    if (matches.length) element.setAttribute("style", [...matches.map((rule) => rule.declarations), element.getAttribute("style") || ""].join(";"));
  }
  const svg = new XMLSerializer().serializeToString(document);
  if (!isSafeInlineSvg(new TextEncoder().encode(svg))) throw new Error("invalidFile");
  return svg;
}
