"use client";

import { useRef } from "react";
import { hueSwatch } from "@/lib/color";

const STEP = 5;
// The strip is drawn from the same conversion the matching uses, so the
// colour under the pointer is the hue that gets searched.
const GRADIENT = `linear-gradient(to right, ${Array.from(
  { length: 37 },
  (_, i) => hueSwatch(i * 10),
).join(", ")})`;

type HueBarProps = {
  /** The picked hue in degrees, or null when none is picked. */
  hue: number | null;
  onChange: (hue: number) => void;
};

/** A strip of every hue: click or drag to pick one, arrow keys to nudge it. */
export function HueBar({ hue, onChange }: HueBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function pick(event: React.PointerEvent) {
    const rect = barRef.current!.getBoundingClientRect();
    const fraction = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    onChange(Math.min(359, Math.round(fraction * 360)));
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const current = hue ?? 0;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? (current + STEP) % 360
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? (current - STEP + 360) % 360
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? 355
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(next);
  }

  return (
    <div
      ref={barRef}
      role="slider"
      tabIndex={0}
      aria-label="Hue"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={hue ?? 0}
      aria-valuetext={hue === null ? "No hue picked" : `${hue} degrees`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        pick(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) pick(event);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      onKeyDown={onKeyDown}
      className="relative h-6 w-full cursor-crosshair touch-none border border-black/20 outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f4f4]"
      style={{ backgroundImage: GRADIENT }}
    >
      {hue !== null ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-y-1 w-[5px] -translate-x-1/2 border border-white bg-black shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{ left: `${(hue / 360) * 100}%` }}
        />
      ) : null}
    </div>
  );
}
