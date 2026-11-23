"use client";

import Link from "next/link";
import { useReferences } from "@/components/references-provider";
import { UploadDialog } from "@/components/upload-dialog";

export function LibraryView() {
  const { references, ready } = useReferences();
  const count = references.length;

  return (
    <div className="relative flex min-h-full flex-1 flex-col bg-[#f4f4f4]">
      <header className="px-4 pt-10 pb-8 text-center md:px-8">
        <p className="font-mono text-[11px] leading-relaxed tracking-[0.02em] text-black/80 md:text-xs">
          World Material Library — Design Reference Capture
          <br />
          Photograph, lasso, label, and prompt any detail.
          <br />
          {ready
            ? `${count} ${count === 1 ? "reference" : "references"}`
            : "Loading…"}
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
            {references.map((ref, index) => (
              <li
                key={ref.id}
                className="opacity-0 animate-[wml-fade_0.5s_ease_forwards]"
                style={{ animationDelay: `${Math.min(index, 18) * 28}ms` }}
              >
                <Link
                  href={`/r/${ref.id}`}
                  className="group block aspect-square overflow-hidden bg-[#e8e8e8] outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ref.thumbnailUrl ?? ref.imageUrl}
                    alt={ref.title}
                    className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                  />
                </Link>
              </li>
            ))}
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

      <UploadDialog />
    </div>
  );
}
