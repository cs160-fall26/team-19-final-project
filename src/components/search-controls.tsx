"use client";

import { Search, X } from "lucide-react";
import { HueBar } from "@/components/hue-bar";
import { describeColorPick, TONE_SWATCH, TONES, type ColorPick } from "@/lib/color";
import type { LibraryMode, LibraryScope } from "@/lib/library-url";
import type { LabelCount } from "@/lib/search";

const MODES: { mode: LibraryMode; label: string }[] = [
  { mode: "grid", label: "Grid" },
  { mode: "map", label: "Map" },
];

const SCOPES: { scope: LibraryScope; label: string; placeholder: string }[] = [
  {
    scope: "references",
    label: "References",
    placeholder: "Search labels, titles and descriptions",
  },
  {
    scope: "parts",
    label: "Parts",
    placeholder: "Search parts by keyword, name and use",
  },
];

const SWITCH_BUTTON =
  "text-black/45 underline-offset-4 transition-colors outline-none hover:text-black focus-visible:underline aria-pressed:text-black aria-pressed:underline";

type SearchControlsProps = {
  query: string;
  onQueryChange: (query: string) => void;
  color: ColorPick | null;
  onColorChange: (color: ColorPick | null) => void;
  mode: LibraryMode;
  onModeChange: (mode: LibraryMode) => void;
  /** Whether the box searches the references or the parts taken out of them. */
  scope: LibraryScope;
  onScopeChange: (scope: LibraryScope) => void;
  /** Labels offered under the search box. */
  suggestions: LabelCount[];
  onSuggestion: (label: string) => void;
};

/**
 * The search box with its references / parts switch and, for references, the
 * colour picker and the grid / map switch. Parts have no palette and no place,
 * so those two are left out while parts are searched.
 */
export function SearchControls({
  query,
  onQueryChange,
  color,
  onColorChange,
  mode,
  onModeChange,
  scope,
  onScopeChange,
  suggestions,
  onSuggestion,
}: SearchControlsProps) {
  const searched = SCOPES.find((option) => option.scope === scope) ?? SCOPES[0];
  return (
    <section aria-label="Search" className="mb-6 space-y-4">
      <div className="flex items-center gap-3 border-y border-black py-3">
        <Search aria-hidden className="size-4 shrink-0 text-black/45" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={searched.placeholder}
          aria-label={scope === "parts" ? "Search parts" : "Search references"}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 appearance-none bg-transparent font-mono text-xs tracking-[0.02em] outline-none placeholder:text-black/35 [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
            className="text-black/45 transition-colors hover:text-black"
          >
            <X className="size-4" />
          </button>
        ) : null}
        <div
          role="group"
          aria-label="Search in"
          className="flex shrink-0 items-center gap-4 border-l border-black/15 pl-4 font-mono text-[11px] tracking-wide"
        >
          {SCOPES.map((option) => (
            <button
              key={option.scope}
              type="button"
              aria-pressed={scope === option.scope}
              onClick={() => onScopeChange(option.scope)}
              className={SWITCH_BUTTON}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={
          scope === "parts" ? "hidden" : "flex flex-wrap items-center gap-x-8 gap-y-3"
        }
      >
        <div className="flex min-w-[min(100%,18rem)] flex-1 items-center gap-3">
          <span className="font-mono text-[10px] tracking-[0.14em] text-black/45 uppercase">
            Colour
          </span>
          <div className="flex shrink-0 gap-1.5">
            {TONES.map((tone) => {
              const active = color?.kind === "tone" && color.tone === tone;
              return (
                <button
                  key={tone}
                  type="button"
                  aria-label={`${tone} tones`}
                  aria-pressed={active}
                  onClick={() =>
                    onColorChange(active ? null : { kind: "tone", tone })
                  }
                  className="size-6 border border-black/25 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f4f4] aria-pressed:ring-2 aria-pressed:ring-black aria-pressed:ring-offset-2 aria-pressed:ring-offset-[#f4f4f4]"
                  style={{ backgroundColor: TONE_SWATCH[tone] }}
                />
              );
            })}
          </div>
          <div className="max-w-md min-w-0 flex-1">
            <HueBar
              hue={color?.kind === "hue" ? color.hue : null}
              onChange={(hue) => onColorChange({ kind: "hue", hue })}
            />
          </div>
          {color ? (
            <button
              type="button"
              onClick={() => onColorChange(null)}
              aria-label={`Clear colour (${describeColorPick(color)})`}
              className="text-black/45 transition-colors hover:text-black"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        <div
          role="group"
          aria-label="View"
          className="flex items-center gap-4 font-mono text-[11px] tracking-wide"
        >
          {MODES.map((option) => (
            <button
              key={option.mode}
              type="button"
              aria-pressed={mode === option.mode}
              onClick={() => onModeChange(option.mode)}
              className={SWITCH_BUTTON}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {suggestions.length > 0 ? (
        <ul
          aria-label={scope === "parts" ? "Keywords" : "Labels"}
          className="flex flex-wrap gap-1.5"
        >
          {suggestions.map(({ label, count }) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => onSuggestion(label)}
                className="group border border-black/15 px-2 py-1 font-mono text-[10px] tracking-wide text-black/75 transition-colors outline-none hover:border-black hover:bg-black hover:text-white focus-visible:border-black"
              >
                {label}{" "}
                <span className="text-black/40 group-hover:text-white/60">
                  {count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
