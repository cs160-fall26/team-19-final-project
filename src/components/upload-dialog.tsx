"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BoxSelector } from "@/components/box-selector";
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
import type { BoundingBox, DesignReference } from "@/lib/types";

type Draft = {
  file: File;
  photo: PreparedPhoto;
  facts: PhotoFacts;
};

const WHOLE_PHOTO: BoundingBox = { x: 0, y: 0, width: 1, height: 1 };

export function UploadDialog() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [box, setBox] = useState<BoundingBox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reading" | "extracting" | null>(null);
  const { addReference } = useReferences();
  const router = useRouter();

  function reset() {
    setDraft(null);
    setBox(null);
    setError(null);
    setBusy(null);
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
      setBox(null);
    } catch {
      setError(
        "This browser could not open that image. Try a JPG, PNG or WEBP file.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleExtract() {
    if (!draft || !box) return;
    setError(null);
    setBusy("extracting");
    try {
      const { file, photo, facts } = draft;
      const extracted = await requestExtraction({
        image: photo.dataUrl,
        crop: cropToDataUrl(photo, box),
        box,
      });
      const ref: DesignReference = {
        id: `upload-${Date.now()}`,
        title: extracted.title,
        imageUrl: photo.dataUrl,
        labels: extracted.labels,
        semantic: extracted.semantic,
        prompt: extracted.prompt,
        boundingBox: box,
        location: facts.location,
        capturedAt: facts.capturedAt,
        addedAt: new Date().toISOString(),
        metadata: buildMetadata(file, photo, facts, dominantColors(photo, box)),
        model: extracted.model,
      };
      await addReference(ref);
      setOpen(false);
      reset();
      router.push(`/r/${ref.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Extraction failed. Try again.",
      );
      setBusy(null);
    }
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
          className={`max-h-[92vh] gap-5 overflow-y-auto rounded-none border-black/10 ${draft ? "sm:max-w-2xl" : "sm:max-w-md"}`}
        >
          <DialogHeader>
            <DialogTitle className="font-sans text-xl">
              {draft ? "Box the element" : "Capture a reference"}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs text-black/55">
              {draft
                ? "Drag on the photo to draw a box around what you want extracted. Drag the box to move it, or a corner to resize it."
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
                box={box}
                onChange={setBox}
                disabled={extracting}
              />

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

              <div className="flex flex-wrap items-center gap-3">
                <LimeCta
                  onClick={() => void handleExtract()}
                  disabled={!box || extracting}
                >
                  {extracting ? "Extracting…" : "Extract"}
                </LimeCta>
                <button
                  type="button"
                  disabled={extracting}
                  onClick={() => setBox(WHOLE_PHOTO)}
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
                {!box ? (
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
