"use client";

import Link from "next/link";
import { PartCard } from "@/components/part-card";
import type { LibraryPart } from "@/lib/study";

export type PartTile = {
  part: LibraryPart;
  /** The keywords the search matched. */
  matched?: string[];
};

/** Parts from anywhere in the library. Each tile opens its reference with that part shown. */
export function PartGrid({ tiles }: { tiles: PartTile[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {tiles.map(({ part, matched }, index) => (
        <li
          key={`${part.reference.id}/${part.id}`}
          className="animate-[wml-fade_0.5s_ease_forwards] opacity-0"
          style={{ animationDelay: `${Math.min(index, 18) * 28}ms` }}
        >
          <Link
            href={`/r/${part.reference.id}?part=${encodeURIComponent(part.id)}`}
            className="group block outline-none"
          >
            <PartCard part={part} matched={matched} from={part.reference.title} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
