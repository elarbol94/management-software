"use client";

import { useState, type CSSProperties } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { PresentationElement } from "../lib/presentation";

/**
 * The node types are shared by the editor and the player: what a reader sees while
 * presenting has to be the same drawing they arranged, so only interactivity differs.
 */

export type PresentationNodeData = {
  element: PresentationElement;
  editable: boolean;
  onTextChange?: (id: string, text: string) => void;
  [key: string]: unknown;
};

export type PresentationNode = Node<PresentationNodeData, "text" | "image" | "frame" | "shape">;

const MIN_SIZE = 40;

function Resizer({ selected, editable }: { selected: boolean; editable: boolean }) {
  if (!editable) return null;
  return (
    <NodeResizer
      isVisible={selected}
      minWidth={MIN_SIZE}
      minHeight={MIN_SIZE}
      maxWidth={20_000}
      maxHeight={20_000}
      color="var(--color-indigo-500)"
    />
  );
}

function TextNode({ data, selected }: NodeProps<PresentationNode>) {
  const [editing, setEditing] = useState(false);
  const element = data.element;
  if (element.type !== "text") return null;
  const { text, fontSize, bold, color, align } = element.content;

  return (
    <div
      className={cn(
        "h-full w-full",
        data.editable && "cursor-grab rounded-sm active:cursor-grabbing",
        data.editable && selected && "ring-2 ring-indigo-500/60",
      )}
    >
      <Resizer selected={Boolean(selected)} editable={data.editable} />
      {editing && data.editable ? (
        <textarea
          autoFocus
          // nodrag keeps the pointer inside the field instead of panning the canvas.
          className="nodrag nowheel h-full w-full resize-none rounded-sm border border-indigo-400 bg-background/95 p-1 leading-tight outline-none"
          style={{ fontSize, fontWeight: bold ? 700 : 400, textAlign: align, color: color || undefined }}
          defaultValue={text}
          maxLength={5_000}
          onBlur={(event) => {
            data.onTextChange?.(element.id, event.currentTarget.value);
            setEditing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <div
          className={cn("h-full w-full overflow-hidden whitespace-pre-wrap break-words leading-tight", !color && "text-foreground")}
          style={{ fontSize, fontWeight: bold ? 700 : 400, textAlign: align, color: color || undefined }}
          onDoubleClick={() => data.editable && setEditing(true)}
        >
          {text}
        </div>
      )}
    </div>
  );
}

function ImageNode({ data, selected }: NodeProps<PresentationNode>) {
  const element = data.element;
  if (element.type !== "image") return null;
  return (
    <div
      className={cn(
        "h-full w-full overflow-hidden",
        data.editable && "cursor-grab active:cursor-grabbing",
        data.editable && selected && "ring-2 ring-indigo-500/60",
      )}
    >
      <Resizer selected={Boolean(selected)} editable={data.editable} />
      {/* Served by the existing attachment route, which enforces the session check. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/files/${element.content.attachmentId}`}
        alt={element.content.alt}
        draggable={false}
        className="pointer-events-none h-full w-full object-contain"
      />
    </div>
  );
}

function FrameNode({ data, selected }: NodeProps<PresentationNode>) {
  const element = data.element;
  if (element.type !== "frame") return null;
  const { label, shape, color } = element.content;
  return (
    <div
      className={cn(
        "h-full w-full",
        data.editable && "cursor-grab active:cursor-grabbing",
        data.editable && selected && "ring-2 ring-indigo-500/60",
        shape !== "none" && "border-2",
        shape === "circle" && "rounded-full",
        shape === "rect" && "rounded-xl",
        // An invisible frame is a pure camera target — it stays outlined in the editor
        // so it can be grabbed, and disappears in the player.
        shape === "none" && data.editable && "rounded-xl border-2 border-dashed opacity-50",
        shape !== "none" && !color && "border-foreground/40",
      )}
      style={shape !== "none" && color ? { borderColor: color } : undefined}
    >
      <Resizer selected={Boolean(selected)} editable={data.editable} />
      {label && (
        <span
          className="pointer-events-none absolute -top-6 left-0 truncate text-sm font-medium"
          style={{ color: color || undefined }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * SVG rather than styled divs: a rectangle and an ellipse are as cheap either way, but an
 * arrow and a line are not, and one drawing path keeps stroke and fill behaving alike.
 * Rotation stays on the node wrapper, so it applies to shapes exactly as to everything else.
 */
function ShapeNode({ data, selected }: NodeProps<PresentationNode>) {
  const element = data.element;
  if (element.type !== "shape") return null;
  const { shape, fill, stroke, strokeWidth, opacity } = element.content;
  const w = element.width;
  const h = element.height;
  const inset = strokeWidth / 2;
  // The head has to fit inside the box, so a short arrow degrades to a stub rather than
  // pointing backwards.
  const head = Math.min(Math.max(strokeWidth * 3, 10), w / 2);
  const mid = h / 2;

  return (
    <div
      className={cn(
        "h-full w-full text-foreground",
        data.editable && "cursor-grab active:cursor-grabbing",
        data.editable && selected && "ring-2 ring-indigo-500/60",
      )}
    >
      <Resizer selected={Boolean(selected)} editable={data.editable} />
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="pointer-events-none block h-full w-full overflow-visible"
        style={{ opacity }}
        aria-hidden
      >
        {shape === "rect" && (
          <rect
            x={inset}
            y={inset}
            width={Math.max(w - strokeWidth, 0)}
            height={Math.max(h - strokeWidth, 0)}
            fill={fill || "none"}
            stroke={stroke || "currentColor"}
            strokeWidth={strokeWidth}
          />
        )}
        {shape === "ellipse" && (
          <ellipse
            cx={w / 2}
            cy={h / 2}
            rx={Math.max(w - strokeWidth, 0) / 2}
            ry={Math.max(h - strokeWidth, 0) / 2}
            fill={fill || "none"}
            stroke={stroke || "currentColor"}
            strokeWidth={strokeWidth}
          />
        )}
        {shape === "line" && (
          <line x1={0} y1={mid} x2={w} y2={mid} stroke={stroke || "currentColor"} strokeWidth={strokeWidth} />
        )}
        {shape === "arrow" && (
          <>
            <line x1={0} y1={mid} x2={w - head} y2={mid} stroke={stroke || "currentColor"} strokeWidth={strokeWidth} />
            <polygon
              points={`${w},${mid} ${w - head},${mid - head / 2} ${w - head},${mid + head / 2}`}
              fill={stroke || "currentColor"}
            />
          </>
        )}
      </svg>
    </div>
  );
}

export const presentationNodeTypes = { text: TextNode, image: ImageNode, frame: FrameNode, shape: ShapeNode };

/**
 * Frames sit behind everything else so a text block placed inside one stays grabbable.
 * Within each of those two bands the array index decides what paints on top, which is what
 * "bring to front" / "send to back" reorder. The band offset is larger than the 500-element
 * cap, so a frame can never climb over content.
 */
const FRONT_BAND = 1_000;

export function elementsToNodes(
  elements: PresentationElement[],
  options: {
    editable: boolean;
    selectedId?: string | null;
    onTextChange?: (id: string, text: string) => void;
    /** Ids currently hidden so they can fade in — the player's step-arrival entrance. */
    enteringIds?: Set<string>;
  },
): PresentationNode[] {
  return elements.map((element, index) => {
    const style: CSSProperties = {};
    if (element.rotation) style.transform = `rotate(${element.rotation}deg)`;
    if (element.background) style.backgroundColor = element.background;
    if (options.enteringIds?.has(element.id)) {
      // Fixed, subtle fade on step arrival — deliberately not a per-element setting.
      // A keyframe animation (not a state-driven transition) plays once whenever this
      // element newly becomes part of the arriving step.
      style.animation = "presentation-element-enter 300ms ease";
    }
    return {
      id: element.id,
      type: element.type,
      position: { x: element.x, y: element.y },
      width: element.width,
      height: element.height,
      selected: options.editable ? element.id === options.selectedId : false,
      draggable: options.editable,
      selectable: options.editable,
      connectable: false,
      deletable: options.editable,
      zIndex: (element.type === "frame" ? 0 : FRONT_BAND) + index,
      style: Object.keys(style).length ? style : undefined,
      data: { element, editable: options.editable, onTextChange: options.onTextChange },
    };
  });
}
