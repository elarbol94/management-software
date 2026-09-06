import { figureCrop, type FigureCrop } from "./figure";

export type CropHandle = "move" | "nw" | "ne" | "sw" | "se";
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Pointer deltas are fractions of the original, uncropped image. */
export function transformFigureCrop(initial: FigureCrop, handle: CropHandle, dx: number, dy: number): FigureCrop {
  const crop = figureCrop(initial);
  if (handle === "move") return { ...crop, x: clamp(crop.x + dx, 0, 1 - crop.width), y: clamp(crop.y + dy, 0, 1 - crop.height) };
  let left = crop.x, top = crop.y, right = left + crop.width, bottom = top + crop.height;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - 0.05);
  else right = clamp(right + dx, left + 0.05, 1);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - 0.05);
  else bottom = clamp(bottom + dy, top + 0.05, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A right-hand resize handle moves twice as far relative to a centred figure. */
export function figureResizeDelta(delta: number, alignment: string, wrap: string) {
  if (wrap === "right" || (wrap === "none" && alignment === "right")) return -delta;
  return wrap === "none" && alignment === "center" ? delta * 2 : delta;
}
