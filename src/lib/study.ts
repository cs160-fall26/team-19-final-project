import { call } from "@/lib/storage";

// Deep analysis: a Codex session studies one reference and saves its reusable
// parts beside the photo. The server side is src/lib/study-store.ts; what a
// study holds is described in skills/study/SKILL.md.

/** The owner's words about what they like, passed to the agent. */
export const MAX_STUDY_NOTE_LENGTH = 600;

/** How the latest run for a reference went. */
export type StudyJob = {
  status: "running" | "done" | "failed" | "stopped";
  startedAt: string;
  finishedAt: string | null;
  /** Why it failed or was stopped. */
  error: string | null;
  note: string | null;
  model: string | null;
  tokens: number | null;
};

/** One number of a part that a designer may change. */
export type StudyParameter = {
  name: string;
  value: string;
  /** "8 to 40", or null for a value that is not a number. */
  range: string | null;
  /** True when the number carries the look, so it should stay inside its range. */
  carriesLook: boolean;
  note: string;
};

export type StudyPart = {
  id: string;
  name: string;
  /** Placed as a graphic, filled with content, or followed as an arrangement. */
  useAs: "place" | "fill" | "follow";
  aspect: string;
  keywords: string[];
  /** Requests a designer might type that this part answers. */
  answers: string[];
  unusual: string;
  use: string;
  /** Its editable file, or "image" when the part is only a picture. */
  format: "svg" | "html" | "image";
  /** True when the SVG is written by a function with parameters. */
  fromFunction: boolean;
  /** Why the part has no editable file, when it has none. */
  imageOnly: string | null;
  /** CSS variables that recolour the part from outside. */
  variables: string[];
  parameters: StudyParameter[];
  variants: { label: string; image: string }[];
  /** What the agent says its file still gets wrong. */
  stillDiffers: string[];
  /** The part's picture, drawn from its editable file. */
  image: string;
  /** The region of the photo it came from. */
  crop: string;
  /** The region, the part and the variants side by side; null for an image-only part. */
  check: string | null;
};

export type Study = {
  agent: string | null;
  /** False until the owner has agreed with the agent's choice of parts. */
  confirmed: boolean;
  questions: string[];
  parts: StudyPart[];
};

/** A part together with the reference it was taken from, as the library lists every part. */
export type LibraryPart = StudyPart & {
  reference: { id: string; title: string; labels: string[]; addedAt: string };
};

export type StudyState = {
  /** Null when deep analysis was never started for this reference. */
  job: StudyJob | null;
  /** The study of the latest run that succeeded, or null when none has. */
  study: Study | null;
};

/** The text of a part's editable file, for copying. */
export type StudySource = {
  file: string;
  text: string;
  /** The function that writes the SVG, when the part has one. */
  madeBy: { file: string; text: string } | null;
};

const studyUrl = (id: string) => `/api/references/${encodeURIComponent(id)}/study`;

export function loadStudy(id: string): Promise<StudyState> {
  return call<StudyState>("Could not load the deep analysis", studyUrl(id), {
    cache: "no-store",
  });
}

/** Starts a run. It answers at once; the run itself takes minutes. */
export function startStudy(id: string, note: string): Promise<StudyState> {
  return call<StudyState>("Could not start the deep analysis", studyUrl(id), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
}

export function stopStudy(id: string): Promise<StudyState> {
  return call<StudyState>("Could not stop the deep analysis", studyUrl(id), {
    method: "DELETE",
  });
}

/** Every part in the library, from the newest reference to the oldest. */
export async function loadParts(): Promise<LibraryPart[]> {
  const { parts } = await call<{ parts: LibraryPart[] }>(
    "Could not load the parts",
    "/api/parts",
    { cache: "no-store" },
  );
  return parts;
}

export function loadStudySource(id: string, part: string): Promise<StudySource> {
  return call<StudySource>(
    "Could not read the part's file",
    `${studyUrl(id)}/source/${encodeURIComponent(part)}`,
    { cache: "no-store" },
  );
}
