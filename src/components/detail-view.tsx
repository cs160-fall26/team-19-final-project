"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { LimeCta } from "@/components/lime-cta";
import { BoundingBoxOverlay } from "@/components/bounding-box-overlay";
import { LocationMap } from "@/components/location-map";
import { useReferences } from "@/components/references-provider";
import {
  formatBytes,
  formatCapturedAt,
  formatCoordinates,
  formatDate,
} from "@/lib/format";
import type { DesignReference } from "@/lib/types";

/** Only rows the file or the model actually supplied. */
function metadataRows(ref: DesignReference): [string, string][] {
  const { metadata, boundingBox: box, location } = ref;
  const percent = (n: number) => `${Math.round(n * 100)}%`;
  const rows: [string, string | undefined][] = [
    ["Labels", ref.labels.join(", ")],
    ["File", `${metadata.fileName} · ${formatBytes(metadata.fileSize)}`],
    ["Format", metadata.fileType || undefined],
    ["Dimensions", `${metadata.width} × ${metadata.height} px`],
    ["Captured", ref.capturedAt ? formatCapturedAt(ref.capturedAt) : undefined],
    ["Camera", metadata.camera],
    ["Lens", metadata.lens],
    [
      "Exposure",
      [
        metadata.focalLength,
        metadata.aperture,
        metadata.shutter,
        metadata.iso !== undefined ? `ISO ${metadata.iso}` : undefined,
      ]
        .filter(Boolean)
        .join(" · ") || undefined,
    ],
    ["Software", metadata.software],
    [
      "Box",
      `${percent(box.width)} × ${percent(box.height)} at ${percent(box.x)}, ${percent(box.y)}`,
    ],
    ["Coords", location ? formatCoordinates(location) : undefined],
    [
      "Altitude",
      location?.altitude !== undefined
        ? `${Math.round(location.altitude)} m`
        : undefined,
    ],
    ["Described by", ref.model],
  ];
  return rows.filter((row): row is [string, string] => Boolean(row[1]));
}

export function DetailView({ id }: { id: string }) {
  const { getById, ready, references } = useReferences();
  const ref = getById(id);
  // Other boxes extracted from the same upload, in the order they were drawn.
  const siblings = ref?.photoId
    ? references
        .filter((r) => r.photoId === ref.photoId && r.id !== ref.id)
        .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
    : [];
  const [metaOpen, setMetaOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (!ready) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-white font-mono text-xs text-black/50">
        Loading reference…
      </div>
    );
  }

  if (!ref) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <p className="font-mono text-xs text-black/55">Reference not found.</p>
        <Link
          href="/"
          className="font-mono text-xs underline underline-offset-4"
        >
          ← Back to library
        </Link>
      </div>
    );
  }

  async function copyPrompt() {
    if (!ref) return;
    try {
      await navigator.clipboard.writeText(ref.prompt);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-white">
      <header className="grid grid-cols-3 items-center border-b border-black/8 px-4 py-4 md:px-8">
        <Link
          href="/"
          className="font-[family-name:var(--font-geist-pixel-square)] text-sm leading-tight tracking-tight text-black transition-opacity hover:opacity-70 md:text-lg"
        >
          world material library
        </Link>
        <p className="text-center font-mono text-[10px] tracking-wide text-black/50">
          Reference
        </p>
        <div className="justify-self-end">
          <Link
            href="/"
            className="font-mono text-[10px] tracking-wide text-black/70 underline-offset-4 hover:underline"
          >
            Library ←
          </Link>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1400px] flex-1 lg:grid-cols-2">
        <aside className="flex flex-col gap-8 px-5 py-8 md:px-10 md:py-12">
          <div className="space-y-2 animate-[wml-rise_0.45s_ease_both]">
            <h1 className="max-w-md text-2xl leading-tight font-medium tracking-tight md:text-3xl">
              {ref.title}
            </h1>
            <p className="font-mono text-[11px] text-black/45">
              {ref.capturedAt
                ? `Captured ${formatCapturedAt(ref.capturedAt)}`
                : `Added ${formatDate(ref.addedAt)} · no capture date in file`}
            </p>
          </div>

          {ref.note ? (
            <section className="space-y-3 animate-[wml-rise_0.5s_ease_both]">
              <h2 className="font-mono text-[10px] tracking-[0.14em] text-black/45 uppercase">
                Your note
              </h2>
              <p className="max-w-prose border-l-2 border-[#CCFF00] pl-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-black/75">
                {ref.note}
              </p>
            </section>
          ) : null}

          <section className="space-y-3 animate-[wml-rise_0.55s_ease_both]">
            <h2 className="font-mono text-[10px] tracking-[0.14em] text-black/45 uppercase">
              Semantic
            </h2>
            <p className="max-w-prose text-sm leading-relaxed text-black/80">
              {ref.semantic}
            </p>
          </section>

          {siblings.length > 0 ? (
            <section className="space-y-3">
              <h2 className="font-mono text-[10px] tracking-[0.14em] text-black/45 uppercase">
                Also from this photo
              </h2>
              <ul className="grid gap-2">
                {siblings.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/r/${s.id}`}
                      className="group flex items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-black"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.thumbnailUrl ?? s.imageUrl}
                        alt=""
                        className="size-10 shrink-0 bg-[#e8e8e8] object-cover"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm group-hover:underline group-hover:underline-offset-4">
                          {s.title}
                        </span>
                        {s.note ? (
                          <span className="block truncate font-mono text-[10px] text-black/45">
                            {s.note}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <Collapsible open={metaOpen} onOpenChange={setMetaOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between border-y border-black py-3 text-left">
              <span className="font-mono text-[11px] tracking-wide">
                Metadata
              </span>
              {metaOpen ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 py-4">
              <dl className="grid gap-3 font-mono text-[11px]">
                {metadataRows(ref).map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[7rem_1fr] gap-2">
                    <dt className="text-black/45">{label}</dt>
                    <dd className="break-words text-black">{value}</dd>
                  </div>
                ))}
                {ref.metadata.palette.length > 0 ? (
                  <div className="grid grid-cols-[7rem_1fr] gap-2">
                    <dt className="text-black/45">Palette</dt>
                    <dd className="flex flex-wrap gap-x-3 gap-y-1 text-black">
                      {ref.metadata.palette.map((hex) => (
                        <span key={hex} className="inline-flex items-center gap-1">
                          <span
                            aria-hidden
                            className="size-3 border border-black/15"
                            style={{ backgroundColor: hex }}
                          />
                          {hex}
                        </span>
                      ))}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={mapOpen} onOpenChange={setMapOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between border-b border-black py-3 text-left">
              <span className="font-mono text-[11px] tracking-wide">
                Map ·{" "}
                {ref.location
                  ? formatCoordinates(ref.location)
                  : "no location in file"}
              </span>
              {mapOpen ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 pb-1">
              {ref.location ? (
                <LocationMap location={ref.location} />
              ) : (
                <p className="bg-[#f6f6f6] px-4 py-6 font-mono text-[11px] leading-relaxed text-black/55">
                  This photo carries no GPS position, so there is nothing to
                  place on the map. Photos keep their location when they come
                  straight from the camera or phone; many messaging and social
                  apps strip it.
                </p>
              )}
            </CollapsibleContent>
          </Collapsible>

          <div className="mt-auto flex flex-wrap items-center gap-3 pt-4 animate-[wml-rise_0.65s_ease_both]">
            <LimeCta onClick={() => void copyPrompt()}>
              {copied ? "Copied" : "Copy Prompt"}
            </LimeCta>
            <Link
              href="/"
              className="inline-flex h-10 items-center justify-center rounded-full border border-black bg-transparent px-5 text-sm font-medium transition-colors hover:bg-black hover:text-white"
            >
              Back to library
            </Link>
          </div>
        </aside>

        <section className="flex items-center justify-center bg-[#ececec] px-4 py-10 md:px-10 md:py-14">
          <div className="relative w-full max-w-xl overflow-hidden bg-[#e4e4e4] shadow-none animate-[wml-fade_0.6s_ease_both]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ref.imageUrl}
              alt={ref.title}
              className="block w-full object-contain"
            />
            <BoundingBoxOverlay box={ref.boundingBox} />
          </div>
        </section>
      </div>
    </div>
  );
}
