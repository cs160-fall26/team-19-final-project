import type { StudyPart } from "@/lib/study";

/** "Graphic to place · SVG from a function": what the part is for and what its file is. */
export function kindOf(part: StudyPart) {
  const use = {
    place: "Graphic to place",
    fill: "Container to fill",
    follow: "Arrangement to follow",
  }[part.useAs];
  const file =
    part.format === "image"
      ? "picture only"
      : part.fromFunction
        ? "SVG from a function"
        : part.format.toUpperCase();
  return `${use} · ${file}`;
}

/**
 * A part as a tile: its picture, its name and its keywords. It goes inside a
 * link or a button that carries the `group` class.
 */
export function PartCard({
  part,
  active,
  matched = [],
  from,
}: {
  part: StudyPart;
  /** True while this part's details are open below the tiles. */
  active?: boolean;
  /** The keywords a search matched; they are shown first and darker. */
  matched?: string[];
  /** The title of the reference the part came from, when the tile is shown away from it. */
  from?: string;
}) {
  const others = part.keywords.filter((keyword) => !matched.includes(keyword));
  return (
    <>
      <span
        className={`flex aspect-[4/3] items-center justify-center bg-[#e8e8e8] p-3 ring-black group-focus-visible:ring-2 ${active ? "ring-1" : ""}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={part.image}
          alt=""
          className="max-h-full max-w-full object-contain shadow-[0_0_0_1px_rgba(0,0,0,0.06)] transition-transform duration-500 ease-out group-hover:scale-[1.03]"
        />
      </span>
      <span className="mt-2 block text-sm leading-snug font-medium">{part.name}</span>
      <span className="mt-1 block font-mono text-[10px] leading-4 text-black/50">
        {matched.length > 0 ? (
          <span className="text-black">{matched.join(" · ")}</span>
        ) : null}
        {matched.length > 0 && others.length > 0 ? " · " : ""}
        {others.join(" · ")}
      </span>
      <span className="mt-1 block font-mono text-[10px] leading-4 text-black/35">
        {from ? `${from} · ` : ""}
        {kindOf(part)}
      </span>
    </>
  );
}
