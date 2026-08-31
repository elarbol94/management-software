"use client";

import { useState } from "react";
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

export type PresentationNode = Node<PresentationNodeData, "text" | "image" | "frame">;

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

export const presentationNodeTypes = { text: TextNode, image: ImageNode, frame: FrameNode };

/**
 * Frames sit behind everything else so a text block placed inside one stays grabbable;
 * that ordering is the only reason element order in the array is not enough.
 */
export function elementsToNodes(
  elements: PresentationElement[],
  options: { editable: boolean; selectedId?: string | null; onTextChange?: (id: string, text: string) => void },
): PresentationNode[] {
  return elements.map((element) => ({
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
    zIndex: element.type === "frame" ? 0 : 1,
    style: element.rotation ? { transform: `rotate(${element.rotation}deg)` } : undefined,
    data: { element, editable: options.editable, onTextChange: options.onTextChange },
  }));
}
