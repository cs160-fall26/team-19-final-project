"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BoxSelector, newBoxId, type DraftBox } from "@/components/box-selector";
import { LimeCta } from "@/components/lime-cta";
import { useReferences } from "@/components/references-provider";
import { requestExtraction } from "@/lib/extraction";
import { formatCapturedAt, formatCoordinates } from "@/lib/format";
import {
  buildMetadata,
  cropToDataUrl,
  dominantColors,
  preparePhoto,
  readPhotoFacts,
  type PhotoFacts,
  type PreparedPhoto,
} from "@/lib/photo";
import { startStudy } from "@/lib/study";
import type { BoundingBox, DesignReference } from "@/lib/types";
import { X } from "lucide-react";

type Draft = {
  file: File;
  photo: PreparedPhoto;
  facts: PhotoFacts;
};

const WHOLE_PHOTO: BoundingBox = { x: 0, y: 0, width: 1, height: 1 };
const NOTE_MAX = 500;

const isWholePhoto = (box: BoundingBox) =>
  box.x === 0 && box.y === 0 && box.width === 1 && box.height === 1;

/** How much is worked out about a new reference. */
type Analysis = "light" | "deep";

const ANALYSES: { value: Analysis; title: string; text: string }[] = [
  {
    value: "light",
    title: "Light",
    text: "A title, labels, a description and a prompt. A few seconds.",
  },
  {
    value: "deep",
    title: "Deep",
    text: "The same, then Codex extracts reusable parts as pictures and editable files, guided by the box's note. Several minutes more.",
  },
];

export function UploadDialog() {
  const inputRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLOListElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [boxes, setBoxes] = useState<DraftBox[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Notes are kept apart from the boxes so redrawing a box keeps its note. */
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reading" | "extracting" | null>(null);
  const [analysis, setAnalysis] = useState<Analysis>("light");
  /** True once this upload has started its deep analysis, so that a retry of failed boxes starts no second one. */
  const studyStarted = useRef(false);
  const { addReference } = useReferences();
  const router = useRouter();

  function reset() {
    setDraft(null);
    setBoxes([]);
    setSelectedId(null);
    setNotes({});
    setError(null);
    setBusy(null);
    studyStarted.current = false;
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    if (busy === "extracting") return;
    setOpen(next);
    if (!next) reset();
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setError(null);
    setBusy("reading");
    try {
      const [photo, facts] = await Promise.all([
        preparePhoto(file),
        readPhotoFacts(file),
      ]);
      setDraft({ file, photo, facts });
      setBoxes([]);
      setSelectedId(null);
      setNotes({});
    } catch {
      setError(
        "This browser could not open that image. Try a JPG, PNG or WEBP file.",
      );
    } finally {
      setBusy(null);
    }
  }

  // Keep the selected box's note in view inside the scrolling list.
  useEffect(() => {
    if (!selectedId) return;
    notesRef.current
      ?.querySelector(`[data-note-for="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId, boxes.length]);

  function removeBox(id: string) {
    setBoxes((prev) => prev.filter((b) => b.id !== id));
    setNotes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (selectedId === id) setSelectedId(null);
  }

  function addWholePhoto() {
    const id = newBoxId();
    setBoxes((prev) => [...prev, { id, ...WHOLE_PHOTO }]);
    setSelectedId(id);
  }

  async function handleExtract() {
    if (!draft || boxes.length === 0) return;
    setError(null);
    setBusy("extracting");
    const { file, photo, facts } = draft;
    const photoId = `photo-${Date.now()}`;
    const now = Date.now();

    // One model call per box, all at once; each box becomes its own reference.
    const results = await Promise.allSettled(
      boxes.map(async ({ id: boxId, ...box }, index) => {
        const note = notes[boxId]?.trim() || undefined;
        const crop = cropToDataUrl(photo, box);
        const extracted = await requestExtraction({
          image: photo.dataUrl,
          crop,
          box,
          note,
        });
        const ref: DesignReference = {
          id: `upload-${now}-${index}`,
          title: extracted.title,
          imageUrl: photo.dataUrl,
          thumbnailUrl: crop,
          labels: extracted.labels,
          semantic: extracted.semantic,
          prompt: extracted.prompt,
          boundingBox: box,
          note,
          photoId,
          location: facts.location,
          capturedAt: facts.capturedAt,
          // The library lists newest first; this keeps box 1 ahead of box 2.
          addedAt: new Date(now + boxes.length - index).toISOString(),
          metadata: buildMetadata(file, photo, facts, dominantColors(photo, box)),
          model: extracted.model,
        };
        await addReference(ref);
        return { boxId, ref };
      }),
    );

    const saved = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const failures = results.flatMap((r) =>
      r.status === "rejected" ? [r.reason] : [],
    );

    // A deep analysis is a Codex run of several minutes, so one upload starts
    // one: for the box drawn last, with that box's note as the hint.
    let studied: DesignReference | null = null;
    if (analysis === "deep" && !studyStarted.current) {
      const latest = saved.find((s) => s.boxId === boxes.at(-1)?.id);
      if (latest) {
        studyStarted.current = true;
        // The reference is saved either way. If the run cannot start, the
        // server records why, and the reference's page shows it and offers
        // to start again.
        await startStudy(latest.ref.id, latest.ref.note ?? "").catch(() => undefined);
        studied = latest.ref;
      }
    }

    if (failures.length === 0) {
      setOpen(false);
      reset();
      // Land where the analysis is running, when one was started.
      router.push(`/r/${(studied ?? saved[0].ref).id}`);
      return;
    }

    // Keep only the boxes that failed, so a retry does not duplicate the rest.
    const savedIds = new Set(saved.map((s) => s.boxId));
    setBoxes((prev) => prev.filter((b) => !savedIds.has(b.id)));
    const first = failures[0];
    const reason =
      first instanceof Error && first.message
        ? first.message
        : "Extraction failed.";
    setError(
      saved.length > 0
        ? `${saved.length} of ${results.length} boxes were saved. The rest failed: ${reason} Try again to retry them.`
        : reason,
    );
    setBusy(null);
  }

  const extracting = busy === "extracting";

  return (
    <>
      <LimeCta
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-40 shadow-sm md:right-8 md:bottom-8"
      >
        Upload
      </LimeCta>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className={`max-h-[92vh] auto-rows-max gap-5 overflow-y-auto rounded-none border-black/10 ${draft ? "top-[4vh]! translate-y-0! sm:max-w-2xl" : "sm:max-w-md"}`}
        >
          <DialogHeader>
            <DialogTitle className="font-sans text-xl">
              {draft ? "Box the element" : "Capture a reference"}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs text-black/55">
              {draft
                ? "Drag on the photo to draw a box around each element you want extracted. Drag a box to move it, or a corner to resize it. Each box becomes its own reference."
                : "Upload a photo, box the element you want, and World Material Library reads the file’s metadata and location and writes a description and prompt for it."}
            </DialogDescription>
          </DialogHeader>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />

          {draft ? (
            <>
              <BoxSelector
                src={draft.photo.dataUrl}
                width={draft.photo.canvas.width}
                height={draft.photo.canvas.height}
                boxes={boxes}
                selectedId={selectedId}
                onChange={setBoxes}
                onSelect={setSelectedId}
                disabled={extracting}
              />

              {boxes.length > 0 ? (
                <ol
                  ref={notesRef}
                  aria-label="Notes for each box"
                  className="grid max-h-[9.5rem] auto-rows-max gap-2 overflow-y-auto overscroll-contain pr-1"
                >
                  {boxes.map((b, index) => {
                    const selected = b.id === selectedId;
                    return (
                      <li
                        key={b.id}
                        data-note-for={b.id}
                        className={`flex items-start gap-2 border p-2 ${selected ? "border-black" : "border-black/10"}`}
                      >
                        <span
                          className={`mt-1 inline-flex h-5 min-w-5 items-center justify-center px-1 font-mono text-[10px] font-medium ${selected ? "bg-[#CCFF00]" : "bg-black/8"}`}
                        >
                          {index + 1}
                        </span>
                        <textarea
                          rows={2}
                          maxLength={NOTE_MAX}
                          disabled={extracting}
                          value={notes[b.id] ?? ""}
                          onFocus={() => setSelectedId(b.id)}
                          onChange={(e) =>
                            setNotes((prev) => ({ ...prev, [b.id]: e.target.value }))
                          }
                          aria-label={`Note for box ${index + 1} (optional)`}
                          placeholder={
                            isWholePhoto(b)
                              ? "Optional note: what in the whole photo you're after"
                              : "Optional note: what you want from this box, e.g. “the woven texture, not the frame”"
                          }
                          className="min-h-10 flex-1 resize-none bg-transparent font-mono text-[11px] leading-relaxed outline-none placeholder:text-black/35 disabled:opacity-60"
                        />
                        <button
                          type="button"
                          disabled={extracting}
                          onClick={() => removeBox(b.id)}
                          aria-label={`Remove box ${index + 1}`}
                          className="mt-0.5 p-1 text-black/45 hover:text-black disabled:opacity-40"
                        >
                          <X className="size-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : null}

              <dl className="grid gap-1 font-mono text-[11px] text-black/60">
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-black/40">Location</dt>
                  <dd>
                    {draft.facts.location
                      ? formatCoordinates(draft.facts.location)
                      : "No GPS position in this file"}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-black/40">Taken</dt>
                  <dd>
                    {draft.facts.capturedAt
                      ? formatCapturedAt(draft.facts.capturedAt)
                      : "No capture date in this file"}
                  </dd>
                </div>
              </dl>

              {/* One line and a sentence: the dialog is already tall with a photo and its notes. */}
              <div
                role="radiogroup"
                aria-label="Analysis"
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[11px]"
              >
                <span className="text-[10px] tracking-[0.14em] text-black/45 uppercase">
                  Analysis
                </span>
                {ANALYSES.map((option) => (
                  <label
                    key={option.value}
                    className={`cursor-pointer underline-offset-4 transition-colors has-focus-visible:underline has-disabled:cursor-default has-disabled:opacity-60 ${
                      analysis === option.value
                        ? "text-black underline"
                        : "text-black/45 hover:text-black"
                    }`}
                  >
                    <input
                      type="radio"
                      name="analysis"
                      value={option.value}
                      checked={analysis === option.value}
                      disabled={extracting}
                      onChange={() => setAnalysis(option.value)}
                      className="sr-only"
                    />
                    {option.title}
                  </label>
                ))}
                <span className="basis-full text-[10px] leading-4 text-black/55">
                  {ANALYSES.find((option) => option.value === analysis)?.text}
                  {analysis === "deep" && boxes.length > 1 ? (
                    <span> Codex studies the latest box only: box {boxes.length}.</span>
                  ) : null}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <LimeCta
                  onClick={() => void handleExtract()}
                  disabled={boxes.length === 0 || extracting}
                >
                  {extracting
                    ? "Extracting…"
                    : boxes.length > 1
                      ? `Extract ${boxes.length}`
                      : "Extract"}
                </LimeCta>
                <button
                  type="button"
                  disabled={extracting || boxes.some(isWholePhoto)}
                  onClick={addWholePhoto}
                  className="font-mono text-[11px] underline underline-offset-4 disabled:opacity-40"
                >
                  Use whole photo
                </button>
                <button
                  type="button"
                  disabled={extracting}
                  onClick={() => {
                    reset();
                    inputRef.current?.click();
                  }}
                  className="font-mono text-[11px] underline underline-offset-4 disabled:opacity-40"
                >
                  Choose another
                </button>
                {boxes.length === 0 ? (
                  <span className="font-mono text-[11px] text-black/45">
                    Draw a box to continue.
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <button
              type="button"
              disabled={busy === "reading"}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void handleFile(e.dataTransfer.files?.[0]);
              }}
              className="flex h-40 w-full flex-col items-center justify-center gap-2 border border-dashed border-black/25 bg-[#f6f6f6] text-sm transition-colors hover:bg-[#efefef] disabled:opacity-60"
            >
              {busy === "reading" ? (
                <span className="font-mono text-xs tracking-wide">
                  Reading photo…
                </span>
              ) : (
                <>
                  <span>Drop or choose an image</span>
                  <span className="font-mono text-[10px] text-black/45">
                    JPG · PNG · WEBP
                  </span>
                </>
              )}
            </button>
          )}

          {error ? (
            <p className="font-mono text-xs text-red-600" role="alert">
              {error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
