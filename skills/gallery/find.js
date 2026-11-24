#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

/*
 * find.js: search the World Material Library gallery, for an agent that is designing something.
 *
 * It reads the library straight from disk, so it works whether or not the
 * app is running, and inside a sandbox that has no network. The app's
 * /api/library/search route answers with the same function.
 *
 * The gallery holds two kinds of things:
 *   references  photos and images the owner saved, each with a title, labels and a description
 *   parts       reusable pieces a deep analysis took out of a reference: each has a picture,
 *               usually an editable file (.svg or .html, some drawn by a .js function),
 *               and words that say what it is for
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const USAGE = `find.js: search the World Material Library gallery for references and reusable parts.

  node find.js [words ...] [--in parts|references|both] [--format svg,html,image]
               [--limit 10] [--files] [--json] [--data <folder>]

  words      what you are looking for, such as: quiet background
             Every word has to match. Without words, everything is listed, newest first.
  --in       where to look: parts, references or both (the default)
  --format   keep only results of these file formats, separated by commas:
               svg    a part with an editable SVG file
               html   a part with an editable HTML and CSS file
               image  a picture: a part that is only a picture, or a reference's photo
  --limit    how many results at most (10)
  --files    also print the text of each part's editable file and of the function behind it
  --json     print JSON instead of text
  --data     the library folder, when it is not the project's data/ folder

A part's words describe its job ("divider", "quiet background"); a reference's
words describe what the image shows. Search for the job first.`;

const FORMATS = ["svg", "html", "image"];
const SCOPES = ["parts", "references", "both"];
const REFERENCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const PART_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PHOTOS = ["image.jpg", "image.png", "image.webp"];
const MAX_FILE_BYTES = 512_000;

/* ---------- reading the library ---------- */

/** Where the library is: the folder given, SPAR_DATA_DIR, or data/ in the project. */
function resolveDataDir(given) {
  const project = path.resolve(__dirname, "..", "..");
  let configured = given || process.env.SPAR_DATA_DIR;
  if (!configured) {
    // The app reads this setting from .env.local. Only that one line is looked at here.
    try {
      const line = fs.readFileSync(path.join(project, ".env.local"), "utf8").split("\n").find((entry) => /^\s*SPAR_DATA_DIR\s*=/.test(entry));
      if (line) configured = line.slice(line.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    } catch {
      // No such file: the default it is.
    }
  }
  if (!configured) return path.join(project, "data");
  if (configured === "~" || configured.startsWith("~/")) return path.join(os.homedir(), configured.slice(1));
  return path.resolve(given ? process.cwd() : project, configured);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** A real file, not a link: a study's folder was written by an agent. */
function isPlainFile(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

const asText = (value, max = 1200) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const asTexts = (value, most, max = 200) => (Array.isArray(value) ? value.map((item) => asText(item, max)).filter(Boolean).slice(0, most) : []);
const asRecord = (value) => (typeof value === "object" && value !== null && !Array.isArray(value) ? value : null);

function loadLibrary(dataDir) {
  const root = path.join(dataDir, "references");
  let ids = [];
  try {
    ids = fs.readdirSync(root).filter((name) => REFERENCE_ID.test(name));
  } catch {
    return { references: [], parts: [] };
  }
  const references = [];
  const parts = [];
  for (const id of ids) {
    const folder = path.join(root, id);
    const stored = asRecord(readJson(path.join(folder, "reference.json")));
    if (!stored) continue;
    const photo = PHOTOS.find((name) => isPlainFile(path.join(folder, name)));
    const reference = {
      kind: "reference",
      id,
      title: asText(stored.title, 200) || id,
      labels: asTexts(stored.labels, 24, 80),
      description: asText(stored.semantic, 2000),
      format: "image",
      addedAt: asText(stored.addedAt, 40),
      folder,
      picture: photo ? path.join(folder, photo) : null,
      pictureUrl: `/api/references/${id}/image`,
      parts: 0,
    };
    references.push(reference);

    const study = asRecord(readJson(path.join(folder, "study.json")));
    const index = asRecord(readJson(path.join(folder, "parts", "index.json")));
    if (!study || !index || !Array.isArray(study.parts) || !Array.isArray(index.parts)) continue;
    const drawn = new Map(index.parts.map((entry) => [asRecord(entry)?.id, asRecord(entry)]));
    for (const entry of study.parts.slice(0, 12)) {
      const part = asRecord(entry);
      const partId = asText(part?.id, 64);
      const facts = drawn.get(partId);
      const picture = path.join(folder, "parts", `${partId}.png`);
      // Only parts whose picture was drawn count: that is what the owner saw and kept.
      if (!part || !facts || !PART_ID.test(partId) || !isPlainFile(picture)) continue;
      const format = facts.format === "svg" || facts.format === "html" ? facts.format : "image";
      const file = format === "image" ? null : path.join(folder, "parts", `${partId}.${format}`);
      const maker = format === "svg" && typeof facts.made_by === "string" ? path.join(folder, "parts", `${partId}.js`) : null;
      if (file && !isPlainFile(file)) continue;
      const params = asRecord(facts.params) ?? {};
      parts.push({
        kind: "part",
        id: `${id}/${partId}`,
        name: asText(part.name, 120) || partId,
        useAs: ["place", "fill", "follow"].includes(part.use_as) ? part.use_as : "place",
        aspect: asText(part.aspect, 40),
        format,
        fromFunction: Boolean(maker && isPlainFile(maker)),
        keywords: asTexts(part.keywords, 6, 60),
        answers: asTexts(part.answers, 4),
        use: asText(part.use),
        unusual: asText(part.unusual),
        imageOnly: format === "image" ? asText(part.image_only, 600) || null : null,
        reference: { id, title: reference.title, labels: reference.labels },
        studiedAt: asText(study.studied_at, 40) || reference.addedAt,
        folder,
        file,
        function: maker && isPlainFile(maker) ? maker : null,
        picture,
        pictureUrl: `/api/references/${id}/study/parts/${partId}.png`,
        variables: (Array.isArray(facts.variables) ? facts.variables : [])
          .map((variable) => ({ name: asText(asRecord(variable)?.name, 60), fallback: asText(asRecord(variable)?.fallback, 80) || null }))
          .filter((variable) => variable.name.startsWith("--"))
          .slice(0, 24),
        parameters: Object.entries(params)
          .slice(0, 16)
          .map(([name, spec]) => ({ name: name.slice(0, 60), spec: asRecord(spec) }))
          .filter(({ spec }) => spec)
          .map(({ name, spec }) => ({
            name,
            value: spec.value ?? null,
            min: typeof spec.min === "number" ? spec.min : null,
            max: typeof spec.max === "number" ? spec.max : null,
            // "look": this number carries the look, so stay inside its range. "free": change it to fit.
            role: spec.role === "look" ? "look" : "free",
            note: asText(spec.note, 300),
          })),
      });
      reference.parts += 1;
    }
  }
  return { references, parts };
}

/* ---------- matching ---------- */

const normalize = (text) => text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
const wordsOf = (text) => normalize(String(text)).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Folds English plurals so that "lines" and "line" are the same word. */
function stem(word) {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && /[^su]s$/.test(word) && !word.endsWith("is")) return word.slice(0, -1);
  return word;
}

/** What an item can be found by, strongest first: [weight, text]. */
function fieldsOf(item) {
  if (item.kind === "part") {
    return [
      [10, item.keywords.join(" ")],
      [8, item.name],
      [6, item.answers.join(" ")],
      [3, `${item.use} ${item.unusual} ${item.aspect} ${item.format} ${item.fromFunction ? "function parameters" : ""}`],
      // The image it came from: weakest, so that a search for a job is not drowned by subjects.
      [2, `${item.reference.title} ${item.reference.labels.join(" ")}`],
    ];
  }
  return [
    [10, item.labels.join(" ")],
    [6, item.title],
    [3, item.description],
  ];
}

/** The item's score for the query, or 0 when some word of the query is found nowhere in it. */
function scoreOf(item, queryWords) {
  const fields = fieldsOf(item).map(([weight, text]) => {
    const words = new Set();
    for (const word of wordsOf(text)) {
      words.add(word);
      words.add(stem(word));
    }
    return { weight, words };
  });
  let score = 0;
  for (const word of queryWords) {
    let best = 0;
    for (const { weight, words } of fields) {
      if (words.has(word) || words.has(stem(word))) best = Math.max(best, weight);
      // A word that only begins one of the item's words counts for less.
      else if (word.length >= 2 && [...words].some((candidate) => candidate.startsWith(word))) best = Math.max(best, weight * 0.7);
    }
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

/**
 * Searches the library.
 *
 * @param {object} options
 * @param {string} [options.dataDir] the library folder; found by itself when left out
 * @param {string} [options.query] words that all have to match; empty lists everything
 * @param {"parts"|"references"|"both"} [options.scope]
 * @param {string[]} [options.formats] any of svg, html, image; empty keeps all
 * @param {number} [options.limit]
 * @param {boolean} [options.files] include the text of each part's files
 */
function searchLibrary({ dataDir, query = "", scope = "both", formats = [], limit = 10, files = false } = {}) {
  const library = loadLibrary(resolveDataDir(dataDir));
  const queryWords = [...new Set(wordsOf(query))];
  const pool = [...(scope === "references" ? [] : library.parts), ...(scope === "parts" ? [] : library.references)].filter(
    (item) => formats.length === 0 || formats.includes(item.format),
  );
  const newest = (item) => item.studiedAt || item.addedAt || "";
  const found = pool
    .map((item) => ({ item, score: queryWords.length === 0 ? 1 : scoreOf(item, queryWords) }))
    .filter(({ score }) => score > 0)
    // Best first. On a tie a part comes before a reference, since it can be used as it is.
    .sort((a, b) => b.score - a.score || (a.item.kind === b.item.kind ? newest(b.item).localeCompare(newest(a.item)) : a.item.kind === "part" ? -1 : 1));

  const results = found.slice(0, Math.max(1, limit)).map(({ item, score }) => {
    const result = { ...item, score: Math.round(score * 10) / 10 };
    if (files && item.kind === "part") {
      const read = (file) => (file && isPlainFile(file) && fs.statSync(file).size <= MAX_FILE_BYTES ? fs.readFileSync(file, "utf8") : null);
      result.text = { file: read(item.file), function: read(item.function) };
    }
    return result;
  });
  return {
    query: queryWords.join(" "),
    in: scope,
    formats,
    total: found.length,
    library: { references: library.references.length, parts: library.parts.length },
    results,
  };
}

/* ---------- printing ---------- */

function describe(found) {
  const lines = [];
  const where = found.in === "both" ? "parts and references" : found.in;
  const kept = found.formats.length > 0 ? `, ${found.formats.join(" or ")} only` : "";
  lines.push(
    found.query
      ? `${found.total} ${found.total === 1 ? "result" : "results"} for "${found.query}" in ${where}${kept}${found.total > found.results.length ? `, the best ${found.results.length} shown` : ""}`
      : `${found.total} in ${where}${kept}${found.total > found.results.length ? `, the newest ${found.results.length} shown` : ""}`,
  );
  lines.push(`(the library holds ${found.library.references} references and ${found.library.parts} parts)`);
  found.results.forEach((result, index) => {
    lines.push("");
    if (result.kind === "part") {
      const made = result.format === "image" ? "picture only" : result.fromFunction ? "svg drawn by a function" : result.format;
      lines.push(`${index + 1}. PART  ${result.name}  [${made}]`);
      lines.push(`   id: ${result.id}   from: ${result.reference.title}`);
      if (result.use) lines.push(`   use: ${result.use}`);
      lines.push(`   keywords: ${result.keywords.join(", ")}`);
      if (result.answers.length > 0) lines.push(`   answers: ${result.answers.join(" | ")}`);
      if (result.file) lines.push(`   file: ${result.file}`);
      if (result.function) lines.push(`   function: ${result.function}`);
      lines.push(`   picture: ${result.picture}`);
      if (result.imageOnly) lines.push(`   not editable: ${result.imageOnly}`);
      if (result.variables.length > 0) lines.push(`   colours you can set: ${result.variables.map((variable) => `${variable.name}${variable.fallback ? ` (${variable.fallback})` : ""}`).join(", ")}`);
      for (const parameter of result.parameters) {
        const range = parameter.min !== null && parameter.max !== null ? `, ${parameter.min} to ${parameter.max}` : "";
        const role = parameter.role === "look" ? "carries the look: stay in range" : "free to change";
        lines.push(`   parameter ${parameter.name} = ${JSON.stringify(parameter.value)}${range} (${role})${parameter.note ? `: ${parameter.note}` : ""}`);
      }
      if (result.text?.file) lines.push(`   --- ${path.basename(result.file)} ---`, result.text.file.trimEnd(), "   ---");
      if (result.text?.function) lines.push(`   --- ${path.basename(result.function)} ---`, result.text.function.trimEnd(), "   ---");
    } else {
      lines.push(`${index + 1}. REFERENCE  ${result.title}  [image]`);
      lines.push(`   id: ${result.id}   labels: ${result.labels.join(", ")}`);
      if (result.description) lines.push(`   ${result.description}`);
      if (result.picture) lines.push(`   picture: ${result.picture}`);
      lines.push(result.parts > 0 ? `   parts taken from it: ${result.parts} (search with --in parts to see them)` : "   no parts have been taken from it yet");
    }
  });
  return lines.join("\n");
}

module.exports = { searchLibrary, FORMATS, SCOPES };

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = { query: [], scope: "both", formats: [], limit: 10, files: false, json: false, dataDir: undefined };
  const stop = (message) => {
    console.error(`find.js: ${message}\n\n${USAGE}`);
    process.exit(2);
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = () => {
      if (args[i + 1] === undefined) stop(`${arg} needs a value.`);
      return args[(i += 1)];
    };
    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--") {
      // Everything after this is words to look for, even one that begins with dashes.
      options.query.push(...args.slice(i + 1));
      break;
    } else if (arg === "--in") {
      options.scope = value();
      if (!SCOPES.includes(options.scope)) stop(`--in is one of: ${SCOPES.join(", ")}.`);
    } else if (arg === "--format") {
      options.formats = value().split(",").map((format) => format.trim().toLowerCase()).filter(Boolean);
      const unknown = options.formats.filter((format) => !FORMATS.includes(format));
      if (unknown.length > 0) stop(`unknown format: ${unknown.join(", ")}. Formats are: ${FORMATS.join(", ")}.`);
    } else if (arg === "--limit") {
      options.limit = Number(value());
      if (!(options.limit >= 1)) stop("--limit is a number of results, 1 or more.");
    } else if (arg === "--data") options.dataDir = value();
    else if (arg === "--files") options.files = true;
    else if (arg === "--json") options.json = true;
    else if (arg.startsWith("--")) stop(`unknown option ${arg}.`);
    else options.query.push(arg);
  }
  const found = searchLibrary({ ...options, query: options.query.join(" ") });
  console.log(options.json ? JSON.stringify(found, null, 2) : describe(found));
}
