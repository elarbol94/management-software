export type ByteRange = { start: number; end: number };

export function parseByteRange(header: string | null, size: number): ByteRange | null {
  if (!header?.startsWith("bytes=") || size <= 0 || header.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return null;
  const [, startText, endText] = match;
  if (!startText && !endText) return null;

  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size) return null;
  const end = Math.min(requestedEnd, size - 1);
  if (end < start) return null;
  return { start, end };
}
