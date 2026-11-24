"use client";

import { useEffect, useRef, useState } from "react";
import { LimeCta } from "@/components/lime-cta";
import { kindOf, PartCard } from "@/components/part-card";
import { formatDate } from "@/lib/format";
import {
  loadStudy,
  loadStudySource,
  MAX_STUDY_NOTE_LENGTH,
  startStudy,
  stopStudy,
  type StudyPart,
  type StudyState,
} from "@/lib/study";

/** How often a running analysis is asked how it is going. */
const POLL_MS = 4000;

const HEADING = "font-mono text-[10px] tracking-[0.14em] text-black/45 uppercase";
const TEXT_LINK =
  "font-mono text-[11px] underline underline-offset-4 disabled:opacity-40";

function reason(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function StudyNoteInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      maxLength={MAX_STUDY_NOTE_LENGTH}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      placeholder="What do you like about it? (optional)"
      aria-label="What do you like about it? Optional."
      className="h-10 w-full max-w-md border border-black/20 bg-white px-3 text-sm outline-none placeholder:text-black/35 focus:border-black disabled:opacity-50"
    />
  );
}

function PartDetail({
  id,
  part,
  onClose,
}: {
  id: string;
  part: StudyPart;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<"file" | "function" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [part.id]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy(which: "file" | "function") {
    try {
      const source = await loadStudySource(id, part.id);
      const text = which === "function" ? source.madeBy?.text : source.text;
      if (!text) throw new Error("This part has no such file.");
      await navigator.clipboard.writeText(text);
      setProblem(null);
      setCopied(which);
    } catch (cause) {
      setProblem(reason(cause, "Could not copy the file."));
    }
  }

  const pictures =
    part.format === "image"
      ? [{ label: "In the photo", src: part.image }]
      : [
          { label: "In the photo", src: part.crop },
          { label: "The part, drawn from its file", src: part.image },
        ];
  const changes = [
    part.variables.length > 0
      ? `Colours through ${part.variables.join(", ")}.`
      : null,
    part.format === "image" ? part.imageOnly : null,
  ].filter(Boolean);

  return (
    <div
      ref={panel}
      className="scroll-mt-6 space-y-6 border border-black/10 bg-[#fafafa] p-4 md:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-lg leading-snug font-medium">{part.name}</h3>
          <p className="font-mono text-[10px] text-black/45">{kindOf(part)}</p>
        </div>
        <button type="button" onClick={onClose} className={TEXT_LINK}>
          Close
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {pictures.map((picture) => (
          <figure key={picture.label} className="space-y-1.5">
            <figcaption className="font-mono text-[10px] text-black/45">
              {picture.label}
            </figcaption>
            <div className="flex items-center justify-center bg-[#e9e9e9] p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={picture.src}
                alt={`${part.name}: ${picture.label.toLowerCase()}`}
                className="block max-h-[60vh] max-w-full"
              />
            </div>
          </figure>
        ))}
      </div>

      {part.variants.length > 0 ? (
        <div className="space-y-2">
          <h4 className={HEADING}>Variants</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            {part.variants.map((variant) => (
              <figure key={variant.image} className="space-y-1.5">
                <div className="flex items-center justify-center bg-[#e9e9e9] p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={variant.image}
                    alt={`${part.name}, variant: ${variant.label}`}
                    className="block max-h-64 max-w-full"
                  />
                </div>
                <figcaption className="font-mono text-[10px] leading-4 text-black/55">
                  {variant.label}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <h4 className={HEADING}>When to use it</h4>
            <p className="max-w-prose text-sm leading-relaxed text-black/80">{part.use}</p>
          </div>
          <div className="space-y-1.5">
            <h4 className={HEADING}>What is unusual</h4>
            <p className="max-w-prose text-sm leading-relaxed text-black/80">
              {part.unusual}
            </p>
          </div>
          {part.stillDiffers.length > 0 ? (
            <div className="space-y-1.5">
              <h4 className={HEADING}>Still differs from the photo</h4>
              <ul className="max-w-prose list-disc space-y-1 pl-4 text-sm leading-relaxed text-black/65">
                {part.stillDiffers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="space-y-5">
          {part.answers.length > 0 ? (
            <div className="space-y-1.5">
              <h4 className={HEADING}>Found by asking for</h4>
              <ul className="space-y-1 font-mono text-[11px] leading-relaxed text-black/75">
                {part.answers.map((answer) => (
                  <li key={answer}>{answer}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {changes.length > 0 || part.parameters.length > 0 ? (
            <div className="space-y-2">
              <h4 className={HEADING}>What can change</h4>
              {changes.map((change) => (
                <p
                  key={change}
                  className="max-w-prose font-mono text-[11px] leading-relaxed break-words text-black/75"
                >
                  {change}
                </p>
              ))}
              {part.parameters.length > 0 ? (
                <dl className="grid gap-2 font-mono text-[11px]">
                  {part.parameters.map((parameter) => (
                    <div
                      key={parameter.name}
                      className="grid grid-cols-[8rem_1fr] gap-2"
                    >
                      <dt className="break-words text-black">{parameter.name}</dt>
                      <dd className="text-black/65">
                        {parameter.value}
                        {parameter.range ? ` (${parameter.range})` : ""}
                        {" · "}
                        {parameter.carriesLook ? "carries the look" : "free to change"}
                        {parameter.note ? ` · ${parameter.note}` : ""}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {part.format === "image" ? (
          <a href={part.image} target="_blank" rel="noreferrer" className={TEXT_LINK}>
            Open the picture
          </a>
        ) : (
          <button type="button" onClick={() => void copy("file")} className={TEXT_LINK}>
            {copied === "file" ? "Copied" : `Copy ${part.format.toUpperCase()}`}
          </button>
        )}
        {part.fromFunction ? (
          <button
            type="button"
            onClick={() => void copy("function")}
            className={TEXT_LINK}
          >
            {copied === "function" ? "Copied" : "Copy the function"}
          </button>
        ) : null}
        {part.check ? (
          <a href={part.check} target="_blank" rel="noreferrer" className={TEXT_LINK}>
            Open the comparison
          </a>
        ) : null}
        {problem ? (
          <span className="font-mono text-[11px] text-red-600" role="alert">
            {problem}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** The parts a deep analysis extracted from one reference, and the controls to run it. */
export function StudySection({
  id,
  part: asked,
}: {
  id: string;
  /** A part to show opened, when the page was reached from a search for parts. */
  part?: string;
}) {
  const [state, setState] = useState<StudyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openPart, setOpenPart] = useState<string | null>(asked ?? null);
  const [now, setNow] = useState(() => Date.now());

  const job = state?.job ?? null;
  const study = state?.study ?? null;
  const running = job?.status === "running";

  useEffect(() => {
    let cancelled = false;
    loadStudy(id).then(
      (loaded) => {
        if (!cancelled) setState(loaded);
      },
      (cause) => {
        if (!cancelled) setError(reason(cause, "Could not load the deep analysis."));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      loadStudy(id).then(
        (loaded) => {
          if (!cancelled) setState(loaded);
        },
        () => {
          // Keep showing what is known; the next round may get an answer.
        },
      );
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, running]);

  async function act(request: () => Promise<StudyState>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      setState(await request());
      setNow(Date.now());
      return true;
    } catch (cause) {
      setError(reason(cause, failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    const started = await act(
      () => startStudy(id, note.trim()),
      "Could not start the deep analysis.",
    );
    if (!started) return;
    setAsking(false);
    setOpenPart(null);
    setNote("");
  }

  const minutes = job
    ? Math.max(0, Math.floor((now - Date.parse(job.startedAt)) / 60_000))
    : 0;
  const opened = study?.parts.find((part) => part.id === openPart) ?? null;

  return (
    <section className="border-t border-black/8 bg-white">
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-5 py-10 md:px-10 md:py-12">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className={HEADING}>Parts</h2>
          {study && job?.status === "done" ? (
            <p className="font-mono text-[10px] text-black/40">
              Deep analysis · {formatDate(job.finishedAt ?? job.startedAt)}
              {job.model ? ` · ${job.model}` : ""}
            </p>
          ) : null}
        </div>

        {state === null && !error ? (
          <p className="font-mono text-[11px] text-black/45">Loading…</p>
        ) : null}

        {running ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2" role="status">
            <p className="flex items-center gap-3 text-sm text-black/80">
              <span
                aria-hidden
                className="size-2 shrink-0 animate-pulse rounded-full bg-black"
              />
              Codex is studying this reference.{" "}
              {minutes < 1 ? "Just started." : `${minutes} min so far.`} It usually
              takes three to ten minutes, and keeps running if you leave this page.
              {study ? " The parts below are from the run before it." : ""}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(() => stopStudy(id), "Could not stop the deep analysis.")
              }
              className={TEXT_LINK}
            >
              Stop
            </button>
          </div>
        ) : null}

        {!running && job && job.status !== "done" ? (
          <p
            className="max-w-prose font-mono text-xs leading-relaxed text-red-600"
            role="alert"
          >
            The last deep analysis {job.status === "stopped" ? "was stopped" : "failed"}.
            {job.error ? ` ${job.error}` : ""}
            {study ? " The parts below are from the run before it." : ""}
          </p>
        ) : null}

        {study ? (
          <>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {study.parts.map((part) => (
                <li key={part.id}>
                  <button
                    type="button"
                    aria-expanded={part.id === openPart}
                    onClick={() =>
                      setOpenPart((current) => (current === part.id ? null : part.id))
                    }
                    className="group block w-full text-left outline-none"
                  >
                    <PartCard part={part} active={part.id === openPart} />
                  </button>
                </li>
              ))}
            </ul>

            {opened ? (
              <PartDetail
                key={opened.id}
                id={id}
                part={opened}
                onClose={() => setOpenPart(null)}
              />
            ) : null}

            {study.questions.length > 0 ? (
              <div className="max-w-prose space-y-1.5">
                <h3 className={HEADING}>The agent asks</h3>
                {study.questions.map((question) => (
                  <p key={question} className="text-sm leading-relaxed text-black/80">
                    {question}
                  </p>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {state && !running && !study ? (
          <p className="max-w-prose text-sm leading-relaxed text-black/65">
            A deep analysis has Codex study this reference and save its reusable
            parts: each as a picture, an editable file and words to find it by. It
            takes several minutes and uses your Codex account.
          </p>
        ) : null}

        {state && !running ? (
          !study || asking ? (
            <div className="flex flex-wrap items-center gap-3">
              <StudyNoteInput value={note} onChange={setNote} disabled={busy} />
              <LimeCta onClick={() => void run()} disabled={busy}>
                {busy ? "Starting…" : study ? "Run again" : "Run deep analysis"}
              </LimeCta>
              {asking ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAsking(false)}
                  className={TEXT_LINK}
                >
                  Cancel
                </button>
              ) : null}
              {study ? (
                <p className="w-full font-mono text-[11px] text-black/45">
                  Running it again replaces these parts with what the new run finds.
                </p>
              ) : null}
            </div>
          ) : (
            <button type="button" onClick={() => setAsking(true)} className={TEXT_LINK}>
              Run the deep analysis again
            </button>
          )
        ) : null}

        {error ? (
          <p className="font-mono text-xs text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
