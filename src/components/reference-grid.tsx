"use client";

import Link from "next/link";
import type { DesignReference } from "@/lib/types";

export type GridTile = {
  ref: DesignReference;
  /** Shown under the photo while searching: why it is here, then what else it is. */
  labels?: { matched: string[]; other: string[] };
};

export function ReferenceGrid({ tiles }: { tiles: GridTile[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 md:gap-3 lg:grid-cols-5 xl:grid-cols-6">
      {tiles.map(({ ref, labels }, index) => (
        <li
          key={ref.id}
          className="animate-[spar-fade_0.5s_ease_forwards] opacity-0"
          style={{ animationDelay: `${Math.min(index, 18) * 28}ms` }}
        >
          <Link
            href={`/r/${ref.id}`}
            className="group block aspect-square overflow-hidden bg-[#e8e8e8] outline-none focus-visible:ring-2 focus-visible:ring-black"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ref.imageUrl}
              alt={ref.title}
              className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            />
          </Link>
          {labels ? (
            <p className="mt-1.5 truncate font-mono text-[10px] leading-4 text-black/40">
              {labels.matched.length > 0 ? (
                <span className="text-black">{labels.matched.join(" · ")}</span>
              ) : null}
              {labels.matched.length > 0 && labels.other.length > 0 ? " · " : ""}
              {labels.other.join(" · ")}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
