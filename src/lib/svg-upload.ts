const FORBIDDEN_SVG_MARKUP = [
  /<!doctype/i,
  /<!entity/i,
  /<\s*(?:script|foreignObject|iframe|object|embed|audio|video|canvas|style|link|meta|base)\b/i,
  /\bon[a-z]+\s*=/i,
  /\b(?:href|xlink:href)\s*=\s*["']\s*(?!#|data:image\/(?:png|jpeg|gif|webp);base64,)/i,
  /\b(?:src|data)\s*=\s*["']\s*(?:https?:|\/\/|\/)/i,
  /\burl\s*\(\s*["']?\s*(?!#)/i,
  /@import\b/i,
  /\bexpression\s*\(/i,
];

export function isSafeInlineSvg(bytes: Uint8Array) {
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
    if (!source || source.length > 5_000_000) return false;
    if (!/<svg(?:\s|>)/i.test(source) || !/<\/svg\s*>$/i.test(source)) return false;
    return FORBIDDEN_SVG_MARKUP.every((pattern) => !pattern.test(source));
  } catch {
    return false;
  }
}
