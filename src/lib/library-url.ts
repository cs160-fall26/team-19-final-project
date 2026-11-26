import { formatColorPick, parseColorPick, type ColorPick } from "@/lib/color";

export type LibraryMode = "grid" | "map";
/** What the search box looks through: the references, or the parts taken out of them. */
export type LibraryScope = "references" | "parts";

/** Everything the library page can be asked to show. */
export type LibraryFilters = {
  query: string;
  color: ColorPick | null;
  mode: LibraryMode;
  scope: LibraryScope;
};

/**
 * The filters live in the URL (`/?q=brass&color=h60&view=map`, or
 * `/?q=divider&in=parts`), so a reload or a link brings the same view back.
 */
export function readFilters(params: {
  get(name: string): string | null;
}): LibraryFilters {
  return {
    query: params.get("q") ?? "",
    color: parseColorPick(params.get("color")),
    mode: params.get("view") === "map" ? "map" : "grid",
    scope: params.get("in") === "parts" ? "parts" : "references",
  };
}

export function filtersHref({ query, color, mode, scope }: LibraryFilters): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query);
  if (scope === "parts") params.set("in", "parts");
  if (color) params.set("color", formatColorPick(color));
  if (mode === "map") params.set("view", "map");
  const search = params.toString();
  return search ? `/?${search}` : "/";
}

// The library as it was last shown in this tab, so that "Back to library" on
// a reference returns to the same search instead of an empty one.
let lastHref = "/";

export function rememberLibraryHref(href: string): void {
  lastHref = href;
}

export function libraryHref(): string {
  return lastHref;
}
