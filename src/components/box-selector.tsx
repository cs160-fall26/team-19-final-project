"use client";

import { useRef } from "react";
import type { BoundingBox } from "@/lib/types";

type Corner = "nw" | "ne" | "sw" | "se";

export type DraftBox = BoundingBox & { id: string };

type Drag =
  /** Drawing or resizing: one corner stays fixed, the pointer is the other. */
  | {
      kind: "stretch";
      id: string;
      anchorX: number;
      anchorY: number;
      /** The box before the drag, or null when this drag is drawing a new one. */
      previous: DraftBox | null;
    }
  | { kind: "move"; id: string; grabX: number; grabY: number };

type Gesture = Drag & {
  startX: number;
  startY: number;
  /** Boxes under the pointer at pointer-down, topmost first. */
  hits: DraftBox[];
  moved: boolean;
};

const MIN_SIZE = 0.03;
/** Pointer travel, in CSS pixels, below which a press counts as a click. */
const CLICK_SLOP = 4;
const CORNERS: { corner: Corner; className: string }[] = [
  { corner: "nw", className: "-top-2 -left-2 cursor-nwse-resize" },
  { corner: "ne", className: "-top-2 -right-2 cursor-nesw-resize" },
  { corner: "sw", className: "-bottom-2 -left-2 cursor-nesw-resize" },
  { corner: "se", className: "-right-2 -bottom-2 cursor-nwse-resize" },
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const area = (b: BoundingBox) => b.width * b.height;
const fillsPhoto = (b: BoundingBox) => b.width >= 0.99 && b.height >= 0.99;

/** Boxes containing the point, smallest (and so topmost) first. */
function boxesAt(boxes: DraftBox[], x: number, y: number) {
  return boxes
    .filter((b) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height)
    .sort((a, b) => area(a) - area(b));
}

let nextId = 0;
export const newBoxId = () => `box-${Date.now()}-${nextId++}`;

type BoxSelectorProps = {
  src: string;
  /** Pixel size of the image, used only for its aspect ratio. */
  width: number;
  height: number;
  boxes: DraftBox[];
  selectedId: string | null;
  onChange: (boxes: DraftBox[]) => void;
  onSelect: (id: string | null) => void;
  disabled?: boolean;
};

/**
 * Drag on an empty part of the photo to draw a new box, drag a box to move
 * it, drag the selected box's corner to resize it. Coordinates are
 * normalized 0–1 against the image.
 */
export function BoxSelector({
  src,
  width,
  height,
  boxes,
  selectedId,
  onChange,
  onSelect,
  disabled,
}: BoxSelectorProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);

  function pointAt(event: React.PointerEvent | React.MouseEvent) {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  const replace = (box: DraftBox) =>
    onChange(boxes.map((b) => (b.id === box.id ? box : b)));

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    const point = pointAt(event);
    const corner = (event.target as HTMLElement).dataset.corner as
      | Corner
      | undefined;
    const selected = boxes.find((b) => b.id === selectedId);
    const hits = boxesAt(boxes, point.x, point.y);
    const start = { startX: event.clientX, startY: event.clientY, hits, moved: false };

    let drag: Drag;
    if (corner && selected) {
      drag = {
        kind: "stretch",
        id: selected.id,
        anchorX: corner.includes("w") ? selected.x + selected.width : selected.x,
        anchorY: corner.includes("n") ? selected.y + selected.height : selected.y,
        previous: selected,
      };
    } else if (selected && hits.includes(selected) && !fillsPhoto(selected)) {
      // Dragging the selected box moves it, even where a smaller box sits on top.
      drag = {
        kind: "move",
        id: selected.id,
        grabX: point.x - selected.x,
        grabY: point.y - selected.y,
      };
    } else {
      // Anywhere else, including over unselected boxes, a drag draws a new
      // box. The box is only added once the pointer actually moves.
      drag = {
        kind: "stretch",
        id: newBoxId(),
        anchorX: point.x,
        anchorY: point.y,
        previous: null,
      };
    }
    gestureRef.current = { ...drag, ...start };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (!gesture.moved) {
      const travel = Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY,
      );
      if (travel < CLICK_SLOP) return;
      gesture.moved = true;
      onSelect(gesture.id);
    }
    const point = pointAt(event);

    if (gesture.kind === "move") {
      const box = boxes.find((b) => b.id === gesture.id);
      if (!box) return;
      replace({
        ...box,
        x: clamp(point.x - gesture.grabX, 0, 1 - box.width),
        y: clamp(point.y - gesture.grabY, 0, 1 - box.height),
      });
      return;
    }
    const next: DraftBox = {
      id: gesture.id,
      x: Math.min(gesture.anchorX, point.x),
      y: Math.min(gesture.anchorY, point.y),
      width: Math.abs(point.x - gesture.anchorX),
      height: Math.abs(point.y - gesture.anchorY),
    };
    onChange(
      boxes.some((b) => b.id === next.id)
        ? boxes.map((b) => (b.id === next.id ? next : b))
        : [...boxes, next],
    );
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (!gesture.moved) {
      // A click selects the topmost box under the pointer, or clears the
      // selection on empty photo.
      onSelect(gesture.hits[0]?.id ?? null);
      return;
    }
    if (gesture.kind !== "stretch") return;
    const box = boxes.find((b) => b.id === gesture.id);
    // A sliver is not a selection: drop the new box, or restore the old size
    // of the one being resized.
    if (!box || box.width < MIN_SIZE || box.height < MIN_SIZE) {
      if (gesture.previous) {
        replace(gesture.previous);
      } else {
        onChange(boxes.filter((b) => b.id !== gesture.id));
        onSelect(null);
      }
    }
  }

  /** Double-click reaches the box underneath the one on top. */
  function onDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (disabled) return;
    const point = pointAt(event);
    const hits = boxesAt(boxes, point.x, point.y);
    if (hits.length < 2) return;
    const index = hits.findIndex((b) => b.id === selectedId);
    onSelect(hits[(index + 1) % hits.length].id);
  }

  // Larger boxes are drawn first so a smaller box is never hidden under one.
  const stacked = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => area(b.box) - area(a.box));
  const selected = boxes.find((b) => b.id === selectedId);

  return (
    <div
      ref={surfaceRef}
      role="application"
      aria-label="Photo. Drag to draw a box around each element to extract. Click a box to select it, double-click to select the box underneath."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      className="relative mx-auto touch-none overflow-hidden bg-[#e4e4e4] select-none data-[disabled=true]:opacity-70"
      data-disabled={disabled ? "true" : "false"}
      style={{
        aspectRatio: `${width} / ${height}`,
        width: `min(100%, calc(52vh * ${width / height}))`,
        cursor: disabled ? "default" : "crosshair",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        className="pointer-events-none block size-full"
      />
      {stacked.map(({ box, index }) => {
        const isSelected = box.id === selectedId;
        return (
          <div
            key={box.id}
            className={`pointer-events-none absolute border-2 shadow-[0_0_0_1px_rgba(0,0,0,0.35)] ${isSelected ? "border-[#CCFF00] bg-[#CCFF00]/10" : "border-white bg-white/10"}`}
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
            }}
          >
            <span
              className={`absolute top-0 left-0 px-1 font-mono text-[10px] leading-4 font-medium text-black ${isSelected ? "bg-[#CCFF00]" : "bg-white/90"}`}
            >
              {index + 1}
            </span>
          </div>
        );
      })}
      {selected && !disabled ? (
        // The selected box's outline and corners sit above every other box,
        // so it can always be seen and resized.
        <div
          aria-hidden
          className="pointer-events-none absolute z-10 outline-2 outline-[#CCFF00]"
          style={{
            left: `${selected.x * 100}%`,
            top: `${selected.y * 100}%`,
            width: `${selected.width * 100}%`,
            height: `${selected.height * 100}%`,
          }}
        >
          {CORNERS.map(({ corner, className }) => (
            <span
              key={corner}
              data-corner={corner}
              className={`pointer-events-auto absolute size-4 border border-black bg-[#CCFF00] ${className}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
