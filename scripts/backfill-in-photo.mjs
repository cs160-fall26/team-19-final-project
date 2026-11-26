#!/usr/bin/env node
// Fills in `inPhoto` (what is visible anywhere in the photo) for references
// saved before the extraction recorded it, so search can find them by
// everything in their photo, not only by what was boxed.
//
//   node scripts/backfill-in-photo.mjs            # every reference missing it
//   node scripts/backfill-in-photo.mjs --dry-run  # list them, change nothing
//
// Reads OPENROUTER_API_KEY (and OPENROUTER_MODEL, SPAR_DATA_DIR) from the
// environment or .env.local. Makes one vision call per reference.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

async function env(name) {
  if (process.env[name]) return process.env[name].trim();
  const file = await readFile(path.join(root, ".env.local"), "utf8").catch(() => "");
  const line = file.split("\n").find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : undefined;
}

const dryRun = process.argv.includes("--dry-run");
const apiKey = await env("OPENROUTER_API_KEY");
const model = (await env("OPENROUTER_MODEL")) || "google/gemini-4-hydrogen";
const dataDir = path.resolve(root, (await env("SPAR_DATA_DIR")) || "data");
const referencesDir = path.join(dataDir, "references");

if (!apiKey && !dryRun) {
  console.error("OPENROUTER_API_KEY is not set (environment or .env.local).");
  process.exit(1);
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["in_photo"],
  properties: {
    in_photo: {
      type: "array",
      description:
        "5 to 10 lowercase nouns for the main things visible anywhere in the photograph: creatures, people, objects, materials and the setting.",
      items: { type: "string" },
    },
  },
};

async function describe(imagePath) {
  const bytes = await readFile(imagePath);
  const ext = path.extname(imagePath).slice(1).toLowerCase();
  const type = ext === "jpg" ? "jpeg" : ext;
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "World Material Library",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "List the main things visible anywhere in this photograph." },
            { type: "image_url", image_url: { url: `data:image/${type};base64,${bytes.toString("base64")}` } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "in_photo", strict: true, schema: SCHEMA },
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  }
  const content = String(payload?.choices?.[0]?.message?.content ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const list = JSON.parse(content).in_photo;
  if (!Array.isArray(list)) throw new Error("No list came back.");
  return [...new Set(list.filter((x) => typeof x === "string").map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

const ids = await readdir(referencesDir).catch(() => []);
let done = 0;
let failed = 0;
for (const id of ids) {
  const dir = path.join(referencesDir, id);
  const recordPath = path.join(dir, "reference.json");
  const record = JSON.parse(await readFile(recordPath, "utf8").catch(() => "null"));
  if (!record || Array.isArray(record.inPhoto)) continue;
  const image = (await readdir(dir)).find((f) => /^image\.(jpe?g|png|webp)$/i.test(f));
  if (!image) {
    console.log(`skip ${id}: no photo file`);
    continue;
  }
  if (dryRun) {
    console.log(`would describe ${id} (${record.title})`);
    continue;
  }
  try {
    const inPhoto = await describe(path.join(dir, image));
    // Re-read in case the app changed the record meanwhile.
    const current = JSON.parse(await readFile(recordPath, "utf8"));
    await writeFile(recordPath, `${JSON.stringify({ ...current, inPhoto }, null, 2)}\n`);
    console.log(`${id} (${record.title}): ${inPhoto.join(", ")}`);
    done += 1;
  } catch (error) {
    console.log(`failed ${id}: ${error.message}`);
    failed += 1;
  }
}
console.log(dryRun ? "Dry run: nothing changed." : `Filled in ${done}, failed ${failed}.`);
