"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { LimeCta } from "@/components/lime-cta";
import { useReferences } from "@/components/references-provider";
import { UploadDialog } from "@/components/upload-dialog";
import { stashReferencesForGenerate } from "@/lib/generation";

export function LibraryView() {
  const { references, ready } = useReferences();
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const count = references.length;

  function toggle(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function stopSelecting() {
    setSelecting(false);
    setSelectedIds([]);
  }

  function generateWithSelection() {
    stashReferencesForGenerate(selectedIds);
    router.push("/generate");
  }

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
          {ready
            ? `${count} ${count === 1 ? "reference" : "references"}`
            : "Loading…"}
          {ready && count > 0 ? (
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
          ) : null}
        </p>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[1400px] flex-1 px-3 pb-28 md:px-6">
        {!ready ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 md:gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square animate-pulse bg-[#e4e4e4]"
              />
            ))}
          </div>
        ) : count === 0 ? (
          <p className="py-24 text-center font-mono text-xs text-black/50">
            No references yet. Upload a photo to start.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 md:gap-3">
            {references.map((ref, index) => {
              const isSelected = selectedIds.includes(ref.id);
              const tile = (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ref.thumbnailUrl ?? ref.imageUrl}
                    alt={ref.title}
                    className={`size-full object-cover transition duration-500 ease-out group-hover:scale-[1.03] ${selecting && !isSelected ? "opacity-60" : ""}`}
                  />
                  {selecting ? (
                    <span
                      aria-hidden
                      className={`absolute top-2 left-2 flex size-6 items-center justify-center rounded-full border ${isSelected ? "border-black bg-[#CCFF00]" : "border-white bg-black/25"}`}
                    >
                      {isSelected ? (
                        <Check className="size-3.5" strokeWidth={2.5} />
                      ) : null}
                    </span>
                  ) : null}
                </>
              );
              const tileClass = `group relative block aspect-square w-full overflow-hidden bg-[#e8e8e8] outline-none focus-visible:ring-2 focus-visible:ring-black ${isSelected ? "ring-2 ring-black ring-offset-2 ring-offset-[#f4f4f4]" : ""}`;
              return (
                <li
                  key={ref.id}
                  className="relative opacity-0 animate-[wml-fade_0.5s_ease_forwards]"
                  style={{ animationDelay: `${Math.min(index, 18) * 28}ms` }}
                >
                  {selecting ? (
                    <button
                      type="button"
                      onClick={() => toggle(ref.id)}
                      aria-pressed={isSelected}
                      className={tileClass}
                    >
                      {tile}
                    </button>
                  ) : (
                    <Link href={`/r/${ref.id}`} className={tileClass}>
                      {tile}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}

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

      {selecting ? (
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
      )}
    </div>
  );
}
