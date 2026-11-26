"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LimeCta } from "@/components/lime-cta";
import { useReferences } from "@/components/references-provider";
import { referenceImage } from "@/lib/generation";

type ReferencePickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ids already attached; they start selected. */
  selectedIds: string[];
  onDone: (ids: string[]) => void;
};

/** Multi-select over the whole library. */
export function ReferencePicker({
  open,
  onOpenChange,
  selectedIds,
  onDone,
}: ReferencePickerProps) {
  const { references } = useReferences();
  const [picked, setPicked] = useState<string[]>(selectedIds);

  function toggle(id: string) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <Dialog
      open={open}
      // Mounted fresh for each opening, so it starts from what is attached now.
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-h-[88vh] auto-rows-max gap-5 overflow-y-auto rounded-none border-black/10 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-sans text-xl">Attach references</DialogTitle>
          <DialogDescription className="font-mono text-xs text-black/55">
            Pick as many as you like. They go with your next message.
          </DialogDescription>
        </DialogHeader>

        {references.length === 0 ? (
          <p className="py-10 text-center font-mono text-xs text-black/50">
            Your library is empty. Upload a photo from the Library first.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {references.map((ref) => {
              const isPicked = picked.includes(ref.id);
              return (
                <li key={ref.id}>
                  <button
                    type="button"
                    onClick={() => toggle(ref.id)}
                    aria-pressed={isPicked}
                    title={ref.title}
                    className={`relative block aspect-square w-full overflow-hidden bg-[#e8e8e8] outline-none focus-visible:ring-2 focus-visible:ring-black ${isPicked ? "ring-2 ring-black ring-offset-2" : ""}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={referenceImage(ref)}
                      alt={ref.title}
                      className={`size-full object-cover ${isPicked ? "" : "opacity-70 hover:opacity-100"}`}
                    />
                    <span
                      aria-hidden
                      className={`absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full border ${isPicked ? "border-black bg-[#CCFF00]" : "border-white bg-black/25"}`}
                    >
                      {isPicked ? <Check className="size-3" strokeWidth={2.5} /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <LimeCta
            onClick={() => {
              onDone(picked);
              onOpenChange(false);
            }}
          >
            {picked.length === 0
              ? "Attach none"
              : `Attach ${picked.length}`}
          </LimeCta>
          {picked.length > 0 ? (
            <button
              type="button"
              onClick={() => setPicked([])}
              className="font-mono text-[11px] underline underline-offset-4"
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setPicked(references.map((r) => r.id))}
            className="font-mono text-[11px] underline underline-offset-4"
          >
            Select all
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
