"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { LimeCta } from "@/components/lime-cta";
import { LibraryMap, type MapItem } from "@/components/library-map";
import { PartGrid, type PartTile } from "@/components/part-grid";
import {
  ReferenceGrid,
  type GridSelection,
  type GridTile,
} from "@/components/reference-grid";
import {
  useReferences,
  type LibraryCopy,
} from "@/components/references-provider";
import { SearchControls } from "@/components/search-controls";
import { UploadDialog } from "@/components/upload-dialog";
import {
  describeColorPick,
  hueSwatch,
  paletteMatch,
  type ColorPick,
} from "@/lib/color";
import {
  filtersHref,
  readFilters,
  rememberLibraryHref,
  type LibraryFilters,
} from "@/lib/library-url";
import { stashReferencesForGenerate } from "@/lib/generation";
import { searchableParts, type SearchablePart } from "@/lib/part-search";
import {
  completeWith,
  searchReferences,
  suggestLabels,
  wordsOf,
  type TextSearch,
} from "@/lib/search";
import type { DesignReference } from "@/lib/types";
import { useParts } from "@/lib/use-parts";
import { useRelated, type RelatedSearch } from "@/lib/use-related";

const CAPTION_LABELS = 3;
const NOTE_CLASS =
  "font-mono text-[11px] leading-relaxed tracking-[0.02em] text-black/55";
const HEADING_CLASS =
  "font-mono text-[10px] tracking-[0.14em] text-black/45 uppercase";

/** Says where a library that this browser still held has got to. */
function LibraryCopyNote({ copy }: { copy: LibraryCopy }) {
  const { total, copied, failed, done, error } = copy;
  const noun = total === 1 ? "reference" : "references";
  const className =
    "mx-auto mt-2 max-w-xl font-mono text-[11px] leading-relaxed tracking-[0.02em] md:text-xs";

  if (total === 0) {
    return (
      <p role="alert" className={`${className} text-red-600`}>
        The library kept in this browser could not be read, so it has not been
        copied to disk.{error ? ` ${error}` : ""}
      </p>
    );
  }
  if (done && failed > 0) {
    return (
      <p role="alert" className={`${className} text-red-600`}>
        {failed} of {total} {noun} could not be copied to disk and{" "}
        {failed === 1 ? "is" : "are"} still stored only in this browser.
        {error ? ` ${error}` : ""}
      </p>
    );
  }
  return (
    <p role="status" className={`${className} text-black/55`}>
      {done
        ? `${total} ${noun} copied from this browser to disk.`
        : `Copying this browser’s library to disk… ${copied + failed} of ${total}`}
    </p>
  );
}

/** The page around the library: masthead, wordmark and footer. */
function LibraryFrame({
  status,
  statusAction,
  note,
  children,
  floating,
}: {
  status: string;
  /** Shown after the status, e.g. the link that starts picking references. */
  statusAction?: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  /** Rendered above the page rather than inside it, e.g. the upload button. */
  floating?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-full flex-1 flex-col bg-[#f4f4f4]">
      <header className="px-4 pt-8 pb-8 text-center md:px-8">
        <div className="mb-7 flex justify-center">
          <AppNav active="library" />
        </div>
        <p className="font-mono text-[11px] leading-relaxed tracking-[0.02em] text-black/80 md:text-xs">
          World Material Library — Design Reference Capture
          <br />
          Photograph, lasso, label, and prompt any detail.
          <br />
          {status}
          {statusAction}
        </p>
        {note}
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[1400px] flex-1 px-3 pb-28 md:px-6">
        {children}

        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-8 z-0 flex justify-center overflow-hidden"
        >
          <span className="select-none font-[family-name:var(--font-geist-pixel-square)] text-[clamp(1rem,8.6vw,7.75rem)] leading-none tracking-tight whitespace-nowrap text-black/[0.06]">
            world material library
          </span>
        </div>
      </main>

      <footer className="relative z-10 border-t border-black/5 px-4 py-6 md:px-8">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-2 font-mono text-[10px] tracking-wide text-black/55 sm:flex-row sm:justify-between">
          <span>World Material Library</span>
          <span>Capture · Extract · Prompt</span>
          <span>EXIF metadata · vision description</span>
          <span>© 2026</span>
        </div>
      </footer>

      {floating}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 md:gap-3 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="aspect-square animate-pulse bg-[#e4e4e4]" />
      ))}
    </div>
  );
}

/** What the page shows until the address bar can be read in the browser. */
export function LibraryFallback() {
  return (
    <LibraryFrame status="Loading…">
      <GridSkeleton />
    </LibraryFrame>
  );
}

type Results = {
  /** True when the query has at least one word in it. */
  searching: boolean;
  /** Keyword matches, or the whole library when nothing is typed. */
  matches: GridTile[];
  /** Close in meaning to the query without containing its words. */
  related: GridTile[];
  corrections: TextSearch["corrections"];
};

function caption(ref: DesignReference, matched: string[]): GridTile["labels"] {
  return {
    matched,
    other: ref.labels
      .filter((label) => !matched.includes(label))
      .slice(0, Math.max(0, CAPTION_LABELS - matched.length)),
  };
}

function findResults(
  references: DesignReference[],
  query: string,
  color: ColorPick | null,
  related: RelatedSearch,
): Results {
  const searching = wordsOf(query).length > 0;
  const colorScore = (ref: DesignReference) =>
    color ? paletteMatch(ref.metadata.palette, color) : 1;

  let matches: GridTile[];
  let corrections: Results["corrections"] = [];
  if (searching) {
    // Ranked by the words; the colour only decides who stays.
    const text = searchReferences(references, query);
    corrections = text.corrections;
    matches = text.matches
      .filter((match) => colorScore(match.ref) > 0)
      .map((match) => ({
        ref: match.ref,
        labels: caption(match.ref, match.labels),
      }));
  } else {
    const scored = references
      .map((ref) => ({ ref, score: colorScore(ref) }))
      .filter((item) => item.score > 0);
    // With only a colour picked, the best colour match comes first.
    if (color) scored.sort((a, b) => b.score - a.score);
    matches = scored.map(({ ref }) => ({ ref }));
  }

  const shown = new Set(matches.map((tile) => tile.ref.id));
  const byId = new Map(references.map((ref) => [ref.id, ref]));
  const relatedTiles: GridTile[] = [];
  if (searching && related.status === "done") {
    for (const { id } of related.results) {
      const ref = byId.get(id);
      if (ref && !shown.has(id) && colorScore(ref) > 0) {
        relatedTiles.push({ ref, labels: caption(ref, []) });
      }
    }
  }
  return { searching, matches, related: relatedTiles, corrections };
}

type PartResults = {
  searching: boolean;
  /** Keyword matches, or every part when nothing is typed. */
  tiles: PartTile[];
  corrections: TextSearch["corrections"];
};

function findParts(parts: SearchablePart[], query: string): PartResults {
  const searching = wordsOf(query).length > 0;
  if (!searching) {
    return { searching, tiles: parts.map(({ part }) => ({ part })), corrections: [] };
  }
  const text = searchReferences(parts, query);
  return {
    searching,
    tiles: text.matches.map((match) => ({
      part: match.ref.part,
      matched: match.labels,
    })),
    corrections: text.corrections,
  };
}

export function LibraryView() {
  const { references, ready, loadError, libraryCopy } = useReferences();
  const searchParams = useSearchParams();
  const router = useRouter();
  // Picking references to take to the Generate page.
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selection: GridSelection | undefined = selecting
    ? {
        selectedIds,
        onToggle: (id) =>
          setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
          ),
      }
    : undefined;

  function stopSelecting() {
    setSelecting(false);
    setSelectedIds([]);
  }

  function generateWithSelection() {
    stashReferencesForGenerate(selectedIds);
    router.push("/generate");
  }
  const [filters, setFilters] = useState<LibraryFilters>(() =>
    readFilters(searchParams),
  );
  const { query, color, mode, scope } = filters;
  const inParts = scope === "parts";

  // Keep the address bar, and where "Back to library" leads, in step.
  useEffect(() => {
    const href = filtersHref(filters);
    rememberLibraryHref(href);
    if (href !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", href);
    }
  }, [filters]);

  // Typing stays instant; the search follows as soon as it can.
  const searched = useDeferredValue(query);
  // Related results are about references, so parts do not ask for them.
  const relatedSearch = useRelated(inParts ? "" : searched);
  const results = useMemo(
    () => findResults(references, searched, color, relatedSearch),
    [references, searched, color, relatedSearch],
  );
  const partsLoad = useParts(inParts);
  const parts = useMemo(
    () => searchableParts(partsLoad.status === "done" ? partsLoad.parts : []),
    [partsLoad],
  );
  const partResults = useMemo(() => findParts(parts, searched), [parts, searched]);
  const suggestions = useMemo(
    () => suggestLabels(inParts ? parts : references, query, 12),
    [inParts, parts, references, query],
  );
  const mapItems = useMemo<MapItem[]>(
    () => [
      ...results.matches.map(({ ref }) => ({ ref, related: false })),
      ...results.related.map(({ ref }) => ({ ref, related: true })),
    ],
    [results],
  );

  const count = references.length;
  const filtering = results.searching || color !== null;
  const status = !ready
    ? "Loading…"
    : loadError
      ? "Library unavailable"
      : `${count} ${count === 1 ? "reference" : "references"}`;

  let content: ReactNode;
  if (!ready) {
    content = <GridSkeleton />;
  } else if (loadError) {
    content = (
      <p
        role="alert"
        className="mx-auto max-w-xl py-24 text-center font-mono text-xs leading-relaxed text-red-600"
      >
        {loadError}
      </p>
    );
  } else if (count === 0) {
    content = (
      <p className="py-24 text-center font-mono text-xs text-black/50">
        No references yet. Upload a photo to start.
      </p>
    );
  } else {
    const located = mapItems.filter((item) => item.ref.location).length;
    content = (
      <>
        <SearchControls
          query={query}
          onQueryChange={(next) => setFilters((f) => ({ ...f, query: next }))}
          color={color}
          onColorChange={(next) => setFilters((f) => ({ ...f, color: next }))}
          mode={mode}
          onModeChange={(next) => setFilters((f) => ({ ...f, mode: next }))}
          scope={scope}
          onScopeChange={(next) => setFilters((f) => ({ ...f, scope: next }))}
          suggestions={suggestions}
          onSuggestion={(label) =>
            setFilters((f) => ({ ...f, query: completeWith(f.query, label) }))
          }
        />

        {inParts ? (
          <section aria-label="Parts">
            {partsLoad.status === "failed" ? (
              <p
                role="alert"
                className="py-16 text-center font-mono text-xs leading-relaxed text-red-600"
              >
                {partsLoad.error}
              </p>
            ) : partsLoad.status !== "done" ? (
              <p className={NOTE_CLASS}>Loading parts…</p>
            ) : parts.length === 0 ? (
              <p className="py-16 text-center font-mono text-xs leading-relaxed text-black/50">
                No parts yet. Run a deep analysis on a reference, and the parts
                it finds appear here.
              </p>
            ) : (
              <>
                <div className="mb-4 space-y-1">
                  <p role="status" className={NOTE_CLASS}>
                    {partResults.searching ? (
                      <>
                        {partResults.tiles.length}{" "}
                        {partResults.tiles.length === 1 ? "part matches" : "parts match"}{" "}
                        “{searched.trim()}”{" · "}
                        <button
                          type="button"
                          onClick={() => setFilters((f) => ({ ...f, query: "" }))}
                          className="underline underline-offset-4 hover:text-black"
                        >
                          Clear
                        </button>
                      </>
                    ) : (
                      `${parts.length} ${parts.length === 1 ? "part" : "parts"} from ${
                        new Set(parts.map(({ part }) => part.reference.id)).size
                      } of ${count} references`
                    )}
                  </p>
                  {partResults.corrections.map(({ typed, used }) => (
                    <p key={typed} className={NOTE_CLASS}>
                      No part says “{typed}”. Showing{" "}
                      {used.map((word) => `“${word}”`).join(", ")} instead.
                    </p>
                  ))}
                </div>
                {partResults.tiles.length > 0 ? (
                  <PartGrid tiles={partResults.tiles} />
                ) : (
                  <p className="py-16 text-center font-mono text-xs text-black/50">
                    No part matches “{searched.trim()}”.
                  </p>
                )}
              </>
            )}
          </section>
        ) : (
          <>
            {filtering ? (
              <div className="mb-4 space-y-1">
                <p role="status" className={NOTE_CLASS}>
                  {results.matches.length}{" "}
                  {results.matches.length === 1 ? "match" : "matches"}
                  {results.searching ? ` for “${searched.trim()}”` : ""}
                  {color?.kind === "tone" ? ` in ${color.tone}` : ""}
                  {color?.kind === "hue" ? (
                    <>
                      {" in "}
                      <span
                        aria-hidden
                        className="inline-block size-2.5 border border-black/25 align-[-1px]"
                        style={{ backgroundColor: hueSwatch(color.hue) }}
                      />
                      <span className="sr-only">{describeColorPick(color)}</span>
                    </>
                  ) : null}
                  {results.related.length > 0
                    ? ` · ${results.related.length} related`
                    : ""}
                  {" · "}
                  <button
                    type="button"
                    onClick={() =>
                      setFilters((f) => ({ ...f, query: "", color: null }))
                    }
                    className="underline underline-offset-4 hover:text-black"
                  >
                    Clear
                  </button>
                </p>
                {results.corrections.map(({ typed, used }) => (
                  <p key={typed} className={NOTE_CLASS}>
                    Nothing in the library says “{typed}”. Showing{" "}
                    {used.map((word) => `“${word}”`).join(", ")} instead.
                  </p>
                ))}
              </div>
            ) : null}

            {mode === "map" ? (
              <section aria-label="Map" className="space-y-3">
                {located > 0 ? (
                  <LibraryMap items={mapItems} />
                ) : (
                  <p className="bg-[#ececec] px-4 py-16 text-center font-mono text-[11px] leading-relaxed text-black/55">
                    {mapItems.length === 0
                      ? "Nothing to place on the map."
                      : "None of these references carries a GPS position, so there is nothing to place on the map."}
                  </p>
                )}
                {located > 0 ? (
                  <p className={NOTE_CLASS}>
                    On the map: {located} of {mapItems.length}{" "}
                    {mapItems.length === 1 ? "reference" : "references"}.
                    {located < mapItems.length
                      ? ` The other ${mapItems.length - located} ${
                          mapItems.length - located === 1 ? "has" : "have"
                        } no GPS position.`
                      : ""}
                    {located > 1
                      ? " Small bubbles around a bigger one are more references nearby; the number counts them all."
                      : ""}
                    {results.related.length > 0
                      ? " Related ones have a dashed outline."
                      : ""}
                  </p>
                ) : null}
                {relatedSearch.status === "failed" ? (
                  <p className={NOTE_CLASS}>
                    Related references are unavailable. {relatedSearch.error}
                  </p>
                ) : null}
              </section>
            ) : (
              <>
                {results.matches.length > 0 ? (
                  <ReferenceGrid tiles={results.matches} selection={selection} />
                ) : (
                  <p className="py-16 text-center font-mono text-xs text-black/50">
                    {results.searching
                      ? `No reference matches “${searched.trim()}”${color ? " in that colour" : ""}.`
                      : "No palette has that colour."}
                  </p>
                )}

                {relatedSearch.status !== "idle" ? (
                  <section aria-label="Related references" className="mt-10">
                    <h2 className={`mb-3 ${HEADING_CLASS}`}>
                      Related · close in meaning
                    </h2>
                    {relatedSearch.status === "loading" ? (
                      <p className={NOTE_CLASS}>Looking for related references…</p>
                    ) : relatedSearch.status === "failed" ? (
                      <p className={NOTE_CLASS}>
                        Related references are unavailable. {relatedSearch.error}
                      </p>
                    ) : results.related.length > 0 ? (
                      <ReferenceGrid tiles={results.related} selection={selection} />
                    ) : (
                      <p className={NOTE_CLASS}>
                        Nothing else in the library is close in meaning.
                      </p>
                    )}
                  </section>
                ) : null}
              </>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <LibraryFrame
      status={status}
      statusAction={
        // Selecting works on the reference grid, not on parts or the map.
        ready && !loadError && count > 0 && !inParts && mode !== "map" ? (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              className="underline underline-offset-4 hover:text-black"
            >
              {selecting ? "Cancel selection" : "Select to generate"}
            </button>
          </>
        ) : null
      }
      note={libraryCopy ? <LibraryCopyNote copy={libraryCopy} /> : null}
      floating={
        selecting && !inParts && mode !== "map" ? (
          <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 md:bottom-8">
            <div className="flex items-center gap-4 rounded-full border border-black/10 bg-white py-1.5 pr-1.5 pl-5 shadow-sm">
              <span className="font-mono text-[11px] tracking-wide">
                {selectedIds.length === 0
                  ? "Pick references"
                  : `${selectedIds.length} selected`}
              </span>
              {selectedIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="font-mono text-[11px] text-black/55 underline underline-offset-4 hover:text-black"
                >
                  Clear
                </button>
              ) : null}
              <LimeCta
                onClick={generateWithSelection}
                disabled={selectedIds.length === 0}
              >
                Generate
              </LimeCta>
            </div>
          </div>
        ) : (
          <UploadDialog />
        )
      }
    >
      {content}
    </LibraryFrame>
  );
}
