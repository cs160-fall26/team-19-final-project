#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

/*
 * run-codex.js: runs one study as a Codex session and records how it went.
 *
 *   node run-codex.js <reference folder> <run folder> [--note "what the owner likes about it"]
 *
 * The reference folder holds image.* and reference.json. The run folder must
 * be outside it; it receives:
 *
 *   job.json                    the status, which the app polls
 *   work/                       the folder the agent works in
 *   transcript.log and others   what the session said and did
 *   previous/<time>/            the study a newer one replaced
 *
 * The agent never works in the library itself. It gets a copy of the photo
 * and a short reference.json (title, labels, description, the owner's box),
 * without where or with what the photo was taken. Codex runs in a sandbox
 * that can write only inside work/ and has no network. A browser cannot start
 * in that sandbox, so this script runs the rendering helper (look.js serve)
 * beside it. Nothing the agent wrote is ever run outside the sandbox: the
 * final `page` check runs inside it too. Only when everything succeeded are
 * study.json and parts/ copied into the reference folder, as plain files.
 *
 * Settings, all optional, from the environment:
 *   SPAR_STUDY_MODEL    the Codex model           (gpt-6.1-sol)
 *   SPAR_STUDY_EFFORT   its reasoning effort      (high)
 *   SPAR_STUDY_MINUTES  when to give up           (30)
 *   CODEX_BIN           the codex command to run  (codex)
 *
 * Stop a run with Ctrl-C, or by sending this process SIGINT: it passes the
 * signal on to Codex and to whatever the agent is running.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const SKILL_DIR = path.resolve(__dirname, "..");
const LOOK = path.join(__dirname, "look.js");
const PROMPT = path.join(SKILL_DIR, "codex-prompt.md");

const MODEL = process.env.SPAR_STUDY_MODEL?.trim() || "gpt-6.1-sol";
const EFFORT = process.env.SPAR_STUDY_EFFORT?.trim() || "high";
const MINUTES = Number(process.env.SPAR_STUDY_MINUTES) > 0 ? Number(process.env.SPAR_STUDY_MINUTES) : 30;
const CODEX = process.env.CODEX_BIN?.trim() || "codex";

const PHOTOS = ["image.jpg", "image.png", "image.webp"];
// What the agent is told about the reference. The rest of reference.json
// (the photo's position, date, camera and file name) is not its business.
const SHARED_FIELDS = ["id", "title", "labels", "semantic", "boundingBox"];
// What a study is in the library, and the files of parts/ that belong to it:
// each part's pictures, its editable file, the function behind it, and the index.
const STUDY_ENTRIES = ["study.json", "parts"];
const PART_FILE = /^(?:[a-z0-9][a-z0-9-]{0,63}(?:(?:\.(?:crop|check|v[1-3]))?\.png|\.svg|\.html|\.js)|index\.json)$/;
// The sandbox the agent works in: its own folder only, no shared temporary directory.
const SANDBOX = [
  "--config", "sandbox_workspace_write.exclude_slash_tmp=true",
  "--config", "sandbox_workspace_write.exclude_tmpdir_env_var=true",
];
const NOTE_LINE = "The owner's note about this reference: none.";
const MAX_NOTE_LENGTH = 600;

/** A failure with a sentence the owner can act on. */
class StudyError extends Error {}

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Replaces the file in one step, so a reader never sees half of it. */
function writeWhole(file, text) {
  const staging = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(staging, text);
  fs.renameSync(staging, file);
}

/** Moves a file or folder, also across disks. */
function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

/** True for a real file or folder. A link is neither: the agent could point one anywhere. */
function isPlain(file, kind) {
  try {
    const stat = fs.lstatSync(file);
    return kind === "folder" ? stat.isDirectory() : stat.isFile();
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const positional = [];
  let note = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--note") note = argv[(i += 1)] ?? "";
    else positional.push(argv[i]);
  }
  return { positional, note };
}

/**
 * The prompt for this reference: the tested one, with the owner's note. It
 * names the skill and the owner's earlier remarks by their paths from a
 * reference folder; the agent works elsewhere, so they become full paths.
 */
function buildPrompt(reference, note) {
  const prompt = fs
    .readFileSync(PROMPT, "utf8")
    .replaceAll("../../../skills/study/", `${SKILL_DIR}${path.sep}`)
    .replaceAll("../../taste.md", path.resolve(reference, "..", "..", "taste.md"));
  const said = typeof note === "string" ? note.replace(/\r/g, "").trim().slice(0, MAX_NOTE_LENGTH) : "";
  if (!said) return prompt;
  const quoted = said.split("\n").map((line) => `> ${line}`).join("\n");
  const stated = `The owner's note about this reference, in their words:\n\n${quoted}`;
  return prompt.includes(NOTE_LINE) ? prompt.replace(NOTE_LINE, stated) : `${prompt}\n${stated}\n`;
}

/**
 * Puts the finished study into the library: study.json and the files of
 * parts/, copied one by one so that only plain files with expected names
 * arrive. The study it replaces is kept in the run folder.
 */
function install(work, reference, run) {
  const incoming = path.join(reference, `.study-incoming-${process.pid}`);
  fs.rmSync(incoming, { recursive: true, force: true });
  fs.mkdirSync(path.join(incoming, "parts"), { recursive: true });
  try {
    fs.copyFileSync(path.join(work, "study.json"), path.join(incoming, "study.json"));
    for (const name of fs.readdirSync(path.join(work, "parts"))) {
      const file = path.join(work, "parts", name);
      if (PART_FILE.test(name) && isPlain(file, "file")) fs.copyFileSync(file, path.join(incoming, "parts", name));
    }
    const replaced = [...STUDY_ENTRIES, "study.html", "study.png"].filter((name) => fs.existsSync(path.join(reference, name)));
    const kept = path.join(run, "previous", now().replace(/[:.]/g, "-"));
    for (const name of replaced) move(path.join(reference, name), path.join(kept, name));
    for (const name of STUDY_ENTRIES) fs.renameSync(path.join(incoming, name), path.join(reference, name));
  } finally {
    fs.rmSync(incoming, { recursive: true, force: true });
  }
}

async function main() {
  const { positional, note: noteArg } = parseArgs(process.argv.slice(2));
  if (positional.length !== 2) {
    console.error('usage: node run-codex.js <reference folder> <run folder> [--note "what the owner likes about it"]');
    process.exit(2);
  }
  if (!fs.existsSync(positional[0])) {
    console.error(`run-codex.js: no such reference folder: ${positional[0]}`);
    process.exit(2);
  }
  const reference = fs.realpathSync(positional[0]);
  fs.mkdirSync(positional[1], { recursive: true });
  const run = fs.realpathSync(positional[1]);
  if (run === reference || run.startsWith(reference + path.sep)) {
    console.error("run-codex.js: the run folder must be outside the reference folder.");
    process.exit(2);
  }

  const jobFile = path.join(run, "job.json");
  // The app writes the job file just before it starts this script. Only then
  // is the note in it meant for this run; anything else there is an older run's.
  const asked = readJson(jobFile);
  const note = noteArg ?? (asked?.status === "running" && asked.pid === null ? asked.note : null) ?? null;
  let job = {};
  const record = (changes) => {
    job = { ...job, ...changes, beatAt: now() };
    writeWhole(jobFile, `${JSON.stringify(job, null, 2)}\n`);
  };
  record({
    status: "running",
    note,
    pid: process.pid,
    startedAt: now(),
    finishedAt: null,
    model: MODEL,
    effort: EFFORT,
    sessionId: null,
    tokens: null,
    verified: null,
    error: null,
  });
  // The app tells a run that is still alive from one that died with its machine by this.
  const heartbeat = setInterval(() => record({}), 10_000);

  let helper = null;
  let codex = null;
  let stopped = false;
  const interrupt = () => {
    stopped = true;
    // Like Ctrl-C in the session's terminal: codex stops the turn and the command the agent was running.
    if (codex?.pid && codex.exitCode === null) {
      try {
        process.kill(-codex.pid, "SIGINT");
      } catch {
        // It has already gone.
      }
    }
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);

  const work = path.join(run, "work");
  const temporary = path.join(work, "tmp");
  const transcriptFile = path.join(run, "transcript.log");
  let outcome;
  let result;
  try {
    const photo = PHOTOS.find((name) => fs.existsSync(path.join(reference, name)));
    const stored = readJson(path.join(reference, "reference.json"));
    if (!photo || !stored || typeof stored !== "object") {
      throw new StudyError("This folder is not a stored reference: it needs its photo and reference.json.");
    }
    const version = spawnSync(CODEX, ["--version"], { encoding: "utf8" });
    if (version.error || version.status !== 0) {
      throw new StudyError("The codex command was not found. Deep analysis needs the Codex CLI: install it and run `codex login` (the README says how).");
    }
    const login = spawnSync(CODEX, ["login", "status"], { encoding: "utf8" });
    if (login.status !== 0) {
      throw new StudyError("Codex is not logged in. Run `codex login` in a terminal, then start the deep analysis again.");
    }

    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(temporary, { recursive: true });
    fs.copyFileSync(path.join(reference, photo), path.join(work, photo));
    const shared = Object.fromEntries(SHARED_FIELDS.filter((field) => field in stored).map((field) => [field, stored[field]]));
    fs.writeFileSync(path.join(work, "reference.json"), `${JSON.stringify(shared, null, 2)}\n`);

    // The helper first: the one thing it writes into the agent's folder is written before the agent runs.
    helper = spawn(process.execPath, [LOOK, "serve", work], { stdio: ["ignore", fs.openSync(path.join(run, "helper.log"), "w"), "inherit"] });
    for (let waited = 0; !fs.existsSync(path.join(work, ".look-queue", "helper")); waited += 100) {
      if (helper.exitCode !== null || waited > 10_000) throw new StudyError("The rendering helper did not start. It needs Chrome on this machine; helper.log in the run folder says more.");
      await sleep(100);
    }
    if (stopped) throw new StudyError("Stopped before it finished.");

    const command = [
      CODEX, "exec", "--skip-git-repo-check", "--sandbox", "workspace-write", ...SANDBOX,
      "--model", MODEL, "--config", `model_reasoning_effort=${EFFORT}`,
      "--output-last-message", path.join(run, "last_message.md"), "-",
    ];
    // Keeps a Mac awake until the run has finished.
    if (process.platform === "darwin" && fs.existsSync("/usr/bin/caffeinate")) command.unshift("/usr/bin/caffeinate", "-i");
    const environment = { ...process.env, TMPDIR: temporary };
    codex = spawn(command[0], command.slice(1), {
      cwd: work,
      env: environment,
      // A group of its own, so that one signal reaches codex and whatever the agent is running.
      detached: true,
      stdio: ["pipe", fs.openSync(path.join(run, "final.txt"), "w"), fs.openSync(transcriptFile, "w")],
    });
    codex.stdin.end(buildPrompt(reference, note));
    const limit = setTimeout(() => {
      outcome = `Stopped at the ${MINUTES}-minute limit.`;
      interrupt();
      stopped = false;
    }, MINUTES * 60_000);
    const exitCode = await new Promise((resolve) => {
      codex.on("error", () => resolve(127));
      codex.on("exit", (code) => resolve(code ?? 1));
    });
    clearTimeout(limit);

    const transcript = fs.existsSync(transcriptFile) ? fs.readFileSync(transcriptFile, "utf8") : "";
    const tokens = /^tokens used\n([\d,]+)/m.exec(transcript);
    record({
      sessionId: /^session id: (\S+)/m.exec(transcript)?.[1] ?? null,
      tokens: tokens ? Number(tokens[1].replaceAll(",", "")) : null,
    });
    if (stopped) throw new StudyError("Stopped before it finished.");
    if (outcome) throw new StudyError(outcome);
    if (exitCode !== 0) {
      const reason = transcript.split("\n").filter((line) => line.startsWith("ERROR:")).at(-1);
      throw new StudyError(reason ? `Codex failed. ${reason.slice(0, 300)}` : `Codex ended with exit code ${exitCode}. transcript.log in the run folder says why.`);
    }
    if (!isPlain(path.join(work, "study.json"), "file")) {
      throw new StudyError("Codex finished without saving a study. last_message.md in the run folder holds what it said.");
    }

    // Draw every part once more from the files as they were left, inside the same sandbox,
    // so that the pictures the app shows cannot be older than the files.
    const check = spawnSync(CODEX, ["sandbox", "-c", "sandbox_mode=workspace-write", ...SANDBOX, "--", process.execPath, LOOK, "page", "study.json"], {
      cwd: work,
      env: environment,
      encoding: "utf8",
      timeout: 300_000,
    });
    fs.writeFileSync(path.join(run, "page.log"), `${check.stdout ?? ""}${check.stderr ?? ""}`);
    const said = `${check.stderr ?? ""}${check.stdout ?? ""}`;
    if (/has (?:a problem|problems)\. Nothing was drawn\./.test(said)) {
      const problems = said.split("\n").filter((line) => line.startsWith("  - ")).slice(0, 3).map((line) => line.slice(4));
      throw new StudyError(`The study Codex saved does not follow the format: ${problems.join(" ")}`.slice(0, 600));
    }
    // An older or newer codex may not have this command. The agent's own last drawing then stands.
    record({ verified: check.status === 0 });
    if (!isPlain(path.join(work, "parts"), "folder") || !isPlain(path.join(work, "parts", "index.json"), "file")) {
      throw new StudyError("Codex saved a study but its parts were never drawn. page.log in the run folder says why.");
    }

    install(work, reference, run);
    result = { status: "done" };
  } catch (error) {
    if (!(error instanceof StudyError)) console.error(error);
    result = {
      status: stopped ? "stopped" : "failed",
      error: error instanceof StudyError ? error.message : `The run failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  // Clear up before saying it is over: a new run may start the moment the status changes.
  if (helper && helper.exitCode === null) {
    helper.kill("SIGINT");
    await new Promise((resolve) => helper.on("exit", resolve));
  }
  fs.rmSync(temporary, { recursive: true, force: true });
  clearInterval(heartbeat);
  record({ ...result, finishedAt: now() });
  console.log(`${path.basename(reference)}: ${job.status}${job.error ? `. ${job.error}` : ""}`);
  process.exit(job.status === "done" ? 0 : 1);
}

main();
