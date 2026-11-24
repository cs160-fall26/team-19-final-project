import "server-only";

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  dataDir,
  isReferenceId,
  listReferences,
  referenceDir,
} from "@/lib/reference-store";
import {
  MAX_STUDY_NOTE_LENGTH,
  type LibraryPart,
  type Study,
  type StudyJob,
  type StudyParameter,
  type StudyPart,
  type StudySource,
  type StudyState,
} from "@/lib/study";

/**
 * Deep analysis on disk. A Codex session studies one reference and its
 * reusable parts are saved beside the photo (skills/study/SKILL.md says what
 * a study holds):
 *
 *   <data dir>/references/<id>/study.json     what the agent chose, and why
 *   <data dir>/references/<id>/parts/         each part's pictures and editable file
 *   <data dir>/study-runs/<id>/job.json       how the latest run went
 *   <data dir>/study-runs/<id>/work/          the copy of the reference the agent worked in
 *   <data dir>/study-runs/<id>/…              its transcript and logs
 *
 * The run is a process of its own (skills/study/scripts/run-codex.js), so it
 * outlives the request that started it and a restart of this server. It works
 * on a copy and puts a study into the library only when it succeeded.
 *
 * study.json and parts/ were written by the agent. They are read as data and
 * never trusted: text is cut to length, pictures must be PNG files with
 * expected names, and nothing the agent wrote is ever run or served as a page.
 */

const RUNNER = ["skills", "study", "scripts", "run-codex.js"];
const JOB_FILE = "job.json";
/** The runner rewrites its job file every ten seconds. Silence this long means it is gone. */
const SILENT_AFTER_MS = 60_000;
/** Each run is a Codex session of several minutes, so a slip cannot start dozens. */
const MAX_RUNS_AT_ONCE = 3;
const MAX_PARTS = 12;
const MAX_PICTURE_BYTES = 12_000_000;
const MAX_SOURCE_BYTES = 512_000;

const PART_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** The pictures `look.js page` writes for a part: itself, its region, the comparison, its variants. */
const PICTURE_FILE = /^[a-z0-9][a-z0-9-]{0,63}(?:\.(?:crop|check|v[1-3]))?\.png$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A request this store refuses, with the HTTP status to answer it with. */
export class StudyRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type StoredJob = StudyJob & {
  /** The runner's process, for stopping it. */
  pid: number | null;
  beatAt: string | null;
};

function runDir(id: string) {
  return path.join(dataDir(), "study-runs", id);
}

function missing(error: unknown) {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : "";
  return code === "ENOENT" || code === "ENOTDIR";
}

/** The file as parsed JSON, or null when it is absent or not JSON. */
async function readJson(file: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown, max = 1200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asTexts(value: unknown, most: number, max = 200): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asText(item, max))
    .filter(Boolean)
    .slice(0, most);
}

function asDate(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** A real file of at most `limit` bytes. Links are refused: one could point anywhere on the disk. */
async function readPlainFile(file: string, limit: number): Promise<Buffer | null> {
  try {
    const [folder, stat] = await Promise.all([
      fs.lstat(path.dirname(file)),
      fs.lstat(file),
    ]);
    if (!folder.isDirectory() || !stat.isFile() || stat.size > limit) return null;
    return await fs.readFile(file);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function referenceExists(id: string) {
  if (!isReferenceId(id)) return false;
  try {
    return (await fs.stat(path.join(referenceDir(id), "reference.json"))).isFile();
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function readStoredJob(id: string): Promise<StoredJob | null> {
  const stored = asRecord(await readJson(path.join(runDir(id), JOB_FILE)));
  const status = stored?.status;
  if (
    !stored ||
    (status !== "running" && status !== "done" && status !== "failed" && status !== "stopped")
  ) {
    return null;
  }
  const job: StoredJob = {
    status,
    startedAt: asDate(stored.startedAt) ?? new Date(0).toISOString(),
    finishedAt: asDate(stored.finishedAt),
    error: asText(stored.error) || null,
    note: asText(stored.note, MAX_STUDY_NOTE_LENGTH) || null,
    model: asText(stored.model, 80) || null,
    tokens:
      typeof stored.tokens === "number" && Number.isFinite(stored.tokens)
        ? stored.tokens
        : null,
    pid:
      typeof stored.pid === "number" && Number.isInteger(stored.pid) && stored.pid > 1
        ? stored.pid
        : null,
    beatAt: asDate(stored.beatAt),
  };
  const silent = !job.beatAt || Date.now() - Date.parse(job.beatAt) > SILENT_AFTER_MS;
  if (job.status === "running" && silent) {
    return {
      ...job,
      status: "failed",
      pid: null,
      finishedAt: job.beatAt,
      error:
        "The run ended without finishing: the computer or the run was shut down while it worked.",
    };
  }
  return job;
}

async function writeJob(id: string, job: Record<string, unknown>) {
  const file = path.join(runDir(id), JOB_FILE);
  const staging = `${file}.${process.pid}.tmp`;
  await fs.writeFile(staging, `${JSON.stringify(job, null, 2)}\n`);
  await fs.rename(staging, file);
}

function parameters(value: unknown): StudyParameter[] {
  const given = asRecord(value);
  if (!given) return [];
  const shown = (item: unknown) =>
    typeof item === "string" || typeof item === "number" || typeof item === "boolean"
      ? String(item).slice(0, 80)
      : JSON.stringify(item ?? null).slice(0, 80);
  return Object.entries(given)
    .slice(0, 16)
    .flatMap(([name, entry]): StudyParameter[] => {
      const spec = asRecord(entry);
      if (!spec) return [];
      const ranged =
        typeof spec.value === "number" &&
        typeof spec.min === "number" &&
        typeof spec.max === "number";
      return [
        {
          name: name.slice(0, 60),
          value: shown(spec.value),
          range: ranged ? `${shown(spec.min)} to ${shown(spec.max)}` : null,
          carriesLook: spec.role === "look",
          note: asText(spec.note, 300),
        },
      ];
    });
}

/** The saved study, or null when there is none whose parts were drawn. */
async function readStudy(id: string): Promise<Study | null> {
  const folder = referenceDir(id);
  const indexFile = path.join(folder, "parts", "index.json");
  const saved = asRecord(await readJson(path.join(folder, "study.json")));
  const index = asRecord(await readJson(indexFile));
  if (!saved || !index || !Array.isArray(saved.parts) || !Array.isArray(index.parts)) {
    return null;
  }

  // What `look.js page` found when it drew each part: its format, variables and variants.
  const drawn = new Map<string, Record<string, unknown>>();
  for (const entry of index.parts) {
    const facts = asRecord(entry);
    if (facts && typeof facts.id === "string") drawn.set(facts.id, facts);
  }
  // Pictures are replaced when the study is run again, so their URLs change with it.
  const version = Math.round((await fs.stat(indexFile)).mtimeMs);
  const picture = (file: string) =>
    `/api/references/${id}/study/parts/${file}?v=${version}`;

  const parts: StudyPart[] = [];
  for (const entry of saved.parts.slice(0, MAX_PARTS)) {
    const part = asRecord(entry);
    const partId = asText(part?.id, 64);
    const facts = drawn.get(partId);
    // A part without a drawn picture is left out: the picture is what the owner judges by.
    if (!part || !facts || !PART_ID.test(partId)) continue;
    const format = facts.format === "svg" || facts.format === "html" ? facts.format : "image";
    const variants = Array.isArray(facts.variants) ? facts.variants.slice(0, 3) : [];
    parts.push({
      id: partId,
      name: asText(part.name, 120) || partId,
      useAs: part.use_as === "fill" || part.use_as === "follow" ? part.use_as : "place",
      aspect: asText(part.aspect, 40),
      keywords: asTexts(part.keywords, 6, 60),
      answers: asTexts(part.answers, 4),
      unusual: asText(part.unusual),
      use: asText(part.use),
      format,
      fromFunction: format === "svg" && typeof facts.made_by === "string",
      imageOnly: format === "image" ? asText(part.image_only, 600) || null : null,
      variables: (Array.isArray(facts.variables) ? facts.variables : [])
        .map((variable) => asText(asRecord(variable)?.name, 60))
        .filter((name) => name.startsWith("--"))
        .slice(0, 24),
      parameters: format === "svg" ? parameters(facts.params) : [],
      variants: variants.map((variant, at) => ({
        label: asText(asRecord(variant)?.label, 120) || `Variant ${at + 1}`,
        image: picture(`${partId}.v${at + 1}.png`),
      })),
      stillDiffers: asTexts(asRecord(part.check)?.still_differs, 6, 400),
      image: picture(`${partId}.png`),
      crop: picture(`${partId}.crop.png`),
      check: format === "image" ? null : picture(`${partId}.check.png`),
    });
  }
  if (parts.length === 0) return null;
  return {
    agent: asText(saved.agent, 80) || null,
    confirmed: saved.confirmed === true,
    questions: asTexts(saved.questions, 3, 400),
    parts,
  };
}

async function stateOf(id: string): Promise<StudyState> {
  const stored = await readStoredJob(id);
  const job: StudyJob | null = stored && {
    status: stored.status,
    startedAt: stored.startedAt,
    finishedAt: stored.finishedAt,
    error: stored.error,
    note: stored.note,
    model: stored.model,
    tokens: stored.tokens,
  };
  // A run works on a copy, so the study of the run before it stays in place,
  // and stays shown, until a new one has succeeded.
  return { job, study: await readStudy(id) };
}

/** Where deep analysis stands for a reference, or null when there is no such reference. */
export async function readStudyState(id: string): Promise<StudyState | null> {
  return (await referenceExists(id)) ? stateOf(id) : null;
}

/** Every part of every studied reference, from the newest reference to the oldest. */
export async function listParts(): Promise<LibraryPart[]> {
  const parts: LibraryPart[] = [];
  for (const reference of await listReferences()) {
    const study = await readStudy(reference.id);
    if (!study) continue;
    const from = {
      id: reference.id,
      title: reference.title,
      labels: reference.labels,
      addedAt: reference.addedAt,
    };
    for (const part of study.parts) parts.push({ ...part, reference: from });
  }
  return parts;
}

async function runsInProgress(): Promise<number> {
  let ids: string[];
  try {
    ids = await fs.readdir(path.join(dataDir(), "study-runs"));
  } catch (error) {
    if (missing(error)) return 0;
    throw error;
  }
  const jobs = await Promise.all(
    ids.filter(isReferenceId).map((id) => readStoredJob(id)),
  );
  return jobs.filter((job) => job?.status === "running").length;
}

/** References whose run is being started right now, so two requests cannot start two. */
const starting = new Set<string>();

/**
 * Starts a run for the reference and answers at once; the run takes minutes.
 * A reference that is already being studied is left alone. When the run cannot
 * be started, that is recorded as a failed run, so the reason shows where the
 * owner looks for the result.
 */
export async function startStudy(id: string, note: string): Promise<StudyState> {
  if (!(await referenceExists(id))) throw new StudyRequestError(404, "No such reference.");
  if (starting.has(id) || (await readStoredJob(id))?.status === "running") {
    return stateOf(id);
  }
  starting.add(id);
  try {
    const folder = runDir(id);
    await fs.mkdir(folder, { recursive: true });
    const startedAt = new Date().toISOString();
    const job = {
      status: "running",
      note: note || null,
      startedAt,
      finishedAt: null,
      error: null,
      pid: null,
      beatAt: startedAt,
    };
    const refuse = async (error: string) => {
      await writeJob(id, { ...job, status: "failed", finishedAt: startedAt, error });
      return stateOf(id);
    };

    const runner = path.resolve(...RUNNER);
    if (!(await readPlainFile(runner, MAX_SOURCE_BYTES))) {
      return refuse(
        "Deep analysis is not set up: skills/study is missing from the folder World Material Library runs in.",
      );
    }
    if ((await runsInProgress()) >= MAX_RUNS_AT_ONCE) {
      return refuse(
        `${MAX_RUNS_AT_ONCE} deep analyses are already running. Start this one when one of them has finished.`,
      );
    }

    await writeJob(id, job);
    const log = await fs.open(path.join(folder, "runner.log"), "w");
    try {
      const child = spawn(process.execPath, [runner, referenceDir(id), folder], {
        // Its own process group, so that it keeps running when this server stops.
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
      });
      child.on("error", (error) => {
        void writeJob(id, {
          ...job,
          status: "failed",
          finishedAt: new Date().toISOString(),
          error: `The run could not be started: ${error.message}`,
        });
      });
      child.unref();
    } finally {
      await log.close();
    }
    return await stateOf(id);
  } finally {
    starting.delete(id);
  }
}

/** Asks a running run to stop. It winds down within a few seconds and records that it was stopped. */
export async function stopStudy(id: string): Promise<StudyState> {
  if (!(await referenceExists(id))) throw new StudyRequestError(404, "No such reference.");
  const job = await readStoredJob(id);
  if (job?.status === "running" && job.pid) {
    try {
      // The same signal as Ctrl-C in its terminal; the runner passes it on to Codex.
      process.kill(job.pid, "SIGINT");
    } catch {
      // It finished in the meantime.
    }
  }
  return stateOf(id);
}

/** One of a part's pictures as PNG bytes, or null when there is no such picture. */
export async function readStudyPicture(id: string, file: string): Promise<Buffer | null> {
  if (!isReferenceId(id) || !PICTURE_FILE.test(file)) return null;
  const bytes = await readPlainFile(
    path.join(referenceDir(id), "parts", file),
    MAX_PICTURE_BYTES,
  );
  return bytes && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ? bytes : null;
}

/** The text of a part's editable file, and of the function that writes it when it has one. */
export async function readStudySource(id: string, part: string): Promise<StudySource | null> {
  if (!isReferenceId(id) || !PART_ID.test(part)) return null;
  const folder = path.join(referenceDir(id), "parts");
  const read = async (name: string) =>
    (await readPlainFile(path.join(folder, name), MAX_SOURCE_BYTES))?.toString("utf8") ?? null;

  for (const extension of ["svg", "html"]) {
    const text = await read(`${part}.${extension}`);
    if (text === null) continue;
    const maker = extension === "svg" ? await read(`${part}.js`) : null;
    return {
      file: `parts/${part}.${extension}`,
      text,
      madeBy: maker === null ? null : { file: `parts/${part}.js`, text: maker },
    };
  }
  return null;
}
