import "server-only";

import { createHash } from "node:crypto";
import {
  listReferences,
  readReferenceEmbedding,
  writeReferenceEmbedding,
} from "@/lib/reference-store";
import type { DesignReference } from "@/lib/types";

/**
 * Search by meaning. Each reference's labels, title and description are
 * turned into one vector by an embedding model on OpenRouter and kept next to
 * the reference as embedding.json. A query is embedded the same way and the
 * references whose vectors point the same way are returned as "related".
 */

const EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const DEFAULT_MODEL = "openai/text-embedding-3-small";
/** Texts sent to the model in one request. */
const BATCH_SIZE = 64;
const QUERY_CACHE_SIZE = 200;

export const MAX_QUERY_LENGTH = 200;

/**
 * What counts as related. A short query scores about 0.10 to 0.25 against an
 * unrelated reference and 0.30 to 0.55 against a relevant one, so a reference
 * has to clear a floor and also stand out from the rest of the library.
 * Measured with openai/text-embedding-3-small on a made-up library of 36
 * references, not on real data: look at these numbers again if related
 * results seem too loose or too sparse, or if the model changes (other
 * models put their scores on other scales).
 */
const MIN_SCORE = 0.28;
const MIN_DEVIATIONS_ABOVE_MEAN = 1;
/** Smaller libraries have no meaningful spread, so only the floor applies. */
const MIN_LIBRARY_FOR_SPREAD = 8;
const MAX_RELATED = 12;

export type RelatedReference = { id: string; score: number };

/** A failure the user can do something about, with the HTTP status to send. */
export class SemanticSearchError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function embeddingModel(): string {
  return process.env.OPENROUTER_EMBEDDING_MODEL?.trim() || DEFAULT_MODEL;
}

/** Scaled to length 1, so that a dot product is the cosine similarity. */
function unit(values: unknown): Float32Array | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const vector = new Float32Array(values.length);
  let squares = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value: unknown = values[i];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    vector[i] = value;
    squares += value * value;
  }
  const length = Math.sqrt(squares);
  if (length === 0) return null;
  for (let i = 0; i < vector.length; i += 1) vector[i] /= length;
  return vector;
}

/** One request to OpenRouter: at most BATCH_SIZE texts in, one vector each out. */
async function embed(texts: string[], model: string): Promise<Float32Array[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new SemanticSearchError(
      503,
      "OPENROUTER_API_KEY is not set. Add it to .env.local in the project root.",
    );
  }

  let response: Response;
  try {
    response = await fetch(EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "World Material Library",
      },
      body: JSON.stringify({ model, input: texts }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new SemanticSearchError(
      504,
      timedOut
        ? "OpenRouter did not answer within 30 seconds."
        : "Could not reach OpenRouter.",
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    data?: { index?: unknown; embedding?: unknown }[];
  } | null;
  if (!response.ok || payload?.error || !Array.isArray(payload?.data)) {
    const reason = payload?.error?.message ?? `HTTP ${response.status}`;
    throw new SemanticSearchError(502, `OpenRouter (${model}): ${reason}`);
  }

  const vectors: (Float32Array | null)[] = texts.map(() => null);
  for (const item of payload.data) {
    if (typeof item.index === "number" && item.index in vectors) {
      vectors[item.index] = unit(item.embedding);
    }
  }
  if (vectors.some((vector) => vector === null)) {
    throw new SemanticSearchError(
      502,
      `OpenRouter (${model}) returned an incomplete set of embeddings.`,
    );
  }
  return vectors as Float32Array[];
}

/** What the model reads for a reference. */
function referenceText(ref: DesignReference): string {
  const inPhoto = ref.inPhoto?.length
    ? `\nAlso in the photo: ${ref.inPhoto.join(", ")}`
    : "";
  return `${ref.title}\nLabels: ${ref.labels.join(", ")}\n${ref.semantic}${inPhoto}`;
}

function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// embedding.json keeps the vector as base64 of 32-bit floats: a third of the
// size of a JSON array, and exact.
function encode(vector: Float32Array): string {
  return Buffer.from(
    vector.buffer,
    vector.byteOffset,
    vector.byteLength,
  ).toString("base64");
}

function decode(text: unknown): Float32Array | null {
  if (typeof text !== "string") return null;
  const bytes = Buffer.from(text, "base64");
  if (bytes.length === 0 || bytes.length % 4 !== 0) return null;
  // Copied so that the floats start on a 4-byte boundary.
  return new Float32Array(Uint8Array.from(bytes).buffer);
}

type Indexed = { model: string; fingerprint: string; vector: Float32Array };

// Vectors read or computed by this server process, by reference id.
const index = new Map<string, Indexed>();

/** The reference's vector if one exists for this model and this exact text. */
async function knownVector(
  id: string,
  model: string,
  print: string,
): Promise<Float32Array | null> {
  const held = index.get(id);
  if (held && held.model === model && held.fingerprint === print) {
    return held.vector;
  }
  const raw = await readReferenceEmbedding(id);
  if (!raw) return null;
  try {
    const file = JSON.parse(raw) as Record<string, unknown>;
    if (file.model !== model || file.textHash !== print) return null;
    const vector = decode(file.vector);
    if (!vector) return null;
    index.set(id, { model, fingerprint: print, vector });
    return vector;
  } catch {
    return null;
  }
}

async function buildVectors(
  references: DesignReference[],
  model: string,
): Promise<Map<string, Float32Array>> {
  const vectors = new Map<string, Float32Array>();
  const missing: { id: string; text: string; print: string }[] = [];
  for (const ref of references) {
    const text = referenceText(ref);
    const print = fingerprint(text);
    const vector = await knownVector(ref.id, model, print);
    if (vector) vectors.set(ref.id, vector);
    else missing.push({ id: ref.id, text, print });
  }

  for (let start = 0; start < missing.length; start += BATCH_SIZE) {
    const batch = missing.slice(start, start + BATCH_SIZE);
    const embedded = await embed(
      batch.map((item) => item.text),
      model,
    );
    await Promise.all(
      batch.map(async (item, i) => {
        const vector = embedded[i];
        vectors.set(item.id, vector);
        index.set(item.id, { model, fingerprint: item.print, vector });
        try {
          await writeReferenceEmbedding(
            item.id,
            `${JSON.stringify({
              model,
              textHash: item.print,
              dimensions: vector.length,
              vector: encode(vector),
            })}\n`,
          );
        } catch (error) {
          // The vector still serves this process; it is embedded again after a restart.
          console.warn(
            `World Material Library: could not store the embedding of ${item.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }),
    );
  }

  // Forget references that are no longer in the library.
  for (const id of index.keys()) {
    if (!vectors.has(id)) index.delete(id);
  }
  return vectors;
}

let building: Promise<unknown> = Promise.resolve();

/**
 * One vector per reference. Whatever is missing, or was made by another model
 * or from an older text, is embedded and stored first. Runs one at a time, so
 * a second caller waits and then finds the first one's work done.
 */
function vectorsFor(
  references: DesignReference[],
  model: string,
): Promise<Map<string, Float32Array>> {
  const run = building.then(() => buildVectors(references, model));
  building = run.catch(() => undefined);
  return run;
}

const queryVectors = new Map<string, Float32Array>();

async function queryVector(query: string, model: string): Promise<Float32Array> {
  const key = `${model}\n${query}`;
  const held = queryVectors.get(key);
  if (held) return held;
  const [vector] = await embed([query], model);
  queryVectors.set(key, vector);
  if (queryVectors.size > QUERY_CACHE_SIZE) {
    queryVectors.delete(queryVectors.keys().next().value as string);
  }
  return vector;
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

/**
 * The references closest in meaning to the query, best first. Throws
 * SemanticSearchError when OpenRouter cannot be used.
 */
export async function findRelated(
  query: string,
): Promise<{ model: string; results: RelatedReference[] }> {
  const model = embeddingModel();
  const references = await listReferences();
  if (references.length === 0) return { model, results: [] };

  const [vectors, target] = await Promise.all([
    vectorsFor(references, model),
    queryVector(query, model),
  ]);

  const scored: RelatedReference[] = [];
  for (const [id, vector] of vectors) {
    if (vector.length === target.length) {
      scored.push({ id, score: dot(target, vector) });
    }
  }
  if (scored.length === 0) return { model, results: [] };

  const mean = scored.reduce((sum, item) => sum + item.score, 0) / scored.length;
  const deviation = Math.sqrt(
    scored.reduce((sum, item) => sum + (item.score - mean) ** 2, 0) /
      scored.length,
  );
  const bar =
    scored.length >= MIN_LIBRARY_FOR_SPREAD
      ? Math.max(MIN_SCORE, mean + MIN_DEVIATIONS_ABOVE_MEAN * deviation)
      : MIN_SCORE;

  return {
    model,
    results: scored
      .filter((item) => item.score >= bar)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RELATED)
      .map((item) => ({ id: item.id, score: Math.round(item.score * 1000) / 1000 })),
  };
}

let refreshQueued = false;

/**
 * Embeds whatever is not embedded yet, so that the next search does not have
 * to. Never throws: a search that finds work left over simply does it.
 */
export async function refreshIndex(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) return;
  // Saves tend to come in bursts (a whole library being copied to disk).
  // Wait a moment and embed the burst together instead of one by one.
  if (refreshQueued) return;
  refreshQueued = true;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  refreshQueued = false;
  try {
    await vectorsFor(await listReferences(), embeddingModel());
  } catch (error) {
    console.warn(
      `World Material Library: could not update the search index: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
