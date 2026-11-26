import "server-only";

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DesignReference, GeoPoint } from "@/lib/types";

/**
 * The library on disk. Each reference is one folder holding its photo and a
 * JSON file with everything else:
 *
 *   <data dir>/references/<id>/reference.json
 *   <data dir>/references/<id>/image.jpg
 *   <data dir>/references/<id>/thumbnail.jpg    (the boxed region on its own, when the upload sent one)
 *   <data dir>/references/<id>/embedding.json   (written by search, see semantic-search.ts)
 *
 * The data dir is `data/` in the project root unless SPAR_DATA_DIR says otherwise.
 */

/** Same cap as /api/extract, so any photo that could be described can be stored. */
const MAX_IMAGE_DATA_URL_LENGTH = 8_000_000;
/** The photo and its thumbnail, plus generous room for the rest of the reference. */
export const MAX_REFERENCE_BODY_BYTES = MAX_IMAGE_DATA_URL_LENGTH * 2 + 500_000;
/** Well above what the upload dialog lets a designer type. */
const MAX_NOTE_LENGTH = 2000;

const RECORD_FILE = "reference.json";
const EMBEDDING_FILE = "embedding.json";
const IMAGE_FILES = {
  "image/jpeg": "image.jpg",
  "image/png": "image.png",
  "image/webp": "image.webp",
} as const;
type ImageType = keyof typeof IMAGE_FILES;
const THUMBNAIL_FILES: Record<ImageType, string> = {
  "image/jpeg": "thumbnail.jpg",
  "image/png": "thumbnail.png",
  "image/webp": "thumbnail.webp",
};

/** Ids become folder names, so nothing that could leave the references folder. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const IMAGE_DATA_URL_PATTERN =
  /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Everything in a reference except its pictures, which are files of their own. */
type StoredReference = Omit<DesignReference, "imageUrl" | "thumbnailUrl">;

/** The request described something that is not a storable reference. */
export class InvalidReferenceError extends Error {}

function invalid(message: string): never {
  throw new InvalidReferenceError(message);
}

export function dataDir() {
  const configured = process.env.SPAR_DATA_DIR?.trim();
  if (!configured) return path.resolve("data");
  if (configured === "~" || configured.startsWith("~/")) {
    return path.join(os.homedir(), configured.slice(1));
  }
  return path.resolve(configured);
}

function referencesDir() {
  return path.join(dataDir(), "references");
}

/** True when `id` can name a reference's folder. Check this before `referenceDir`. */
export function isReferenceId(id: string) {
  return ID_PATTERN.test(id);
}

export function referenceDir(id: string) {
  return path.join(referencesDir(), id);
}

function imageUrlFor(id: string) {
  return `/api/references/${id}/image`;
}

function thumbnailUrlFor(id: string) {
  return `/api/references/${id}/thumbnail`;
}

function hasCode(error: unknown, ...codes: string[]) {
  return (
    error instanceof Error &&
    codes.includes((error as NodeJS.ErrnoException).code ?? "")
  );
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(`"${field}" must be text.`);
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined || value === null ? undefined : text(value, field);
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(`"${field}" must be a number.`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  return value === undefined || value === null ? undefined : number(value, field);
}

function within(value: unknown, field: string, min: number, max: number) {
  const n = number(value, field);
  if (n < min || n > max) invalid(`"${field}" must be between ${min} and ${max}.`);
  return n;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`"${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function textList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    invalid(`"${field}" must be a list of text values.`);
  }
  return value as string[];
}

function timestamp(value: unknown, field: string): string {
  const iso = text(value, field);
  if (Number.isNaN(Date.parse(iso))) invalid(`"${field}" must be a date.`);
  return iso;
}

function geoPoint(value: unknown): GeoPoint | null {
  if (value === undefined || value === null) return null;
  const point = object(value, "location");
  const altitude = optionalNumber(point.altitude, "location.altitude");
  return {
    lat: within(point.lat, "location.lat", -90, 90),
    lng: within(point.lng, "location.lng", -180, 180),
    ...(altitude !== undefined ? { altitude } : {}),
  };
}

/** Checks the shape and keeps only the fields a reference is known to have. */
function parseFields(value: unknown): StoredReference {
  const input = object(value, "reference");
  const id = text(input.id, "id");
  if (!ID_PATTERN.test(id)) {
    invalid(`"id" may only contain letters, digits, "-" and "_".`);
  }
  const box = object(input.boundingBox, "boundingBox");
  const metadata = object(input.metadata, "metadata");
  const note = optionalText(input.note, "note")?.trim();
  if (note && note.length > MAX_NOTE_LENGTH) {
    invalid(`"note" is longer than ${MAX_NOTE_LENGTH} characters.`);
  }
  // Becomes part of no path, but it is an id like any other.
  const photoId = optionalText(input.photoId, "photoId");
  if (photoId !== undefined && !ID_PATTERN.test(photoId)) {
    invalid(`"photoId" may only contain letters, digits, "-" and "_".`);
  }
  return {
    id,
    title: text(input.title, "title"),
    labels: textList(input.labels, "labels"),
    semantic: text(input.semantic, "semantic"),
    prompt: text(input.prompt, "prompt"),
    boundingBox: {
      x: within(box.x, "boundingBox.x", 0, 1),
      y: within(box.y, "boundingBox.y", 0, 1),
      width: within(box.width, "boundingBox.width", 0, 1),
      height: within(box.height, "boundingBox.height", 0, 1),
    },
    ...(note ? { note } : {}),
    ...(photoId ? { photoId } : {}),
    location: geoPoint(input.location),
    capturedAt:
      input.capturedAt === undefined || input.capturedAt === null
        ? null
        : timestamp(input.capturedAt, "capturedAt"),
    addedAt: timestamp(input.addedAt, "addedAt"),
    metadata: {
      fileName: text(metadata.fileName, "metadata.fileName"),
      fileType: text(metadata.fileType, "metadata.fileType"),
      fileSize: number(metadata.fileSize, "metadata.fileSize"),
      width: number(metadata.width, "metadata.width"),
      height: number(metadata.height, "metadata.height"),
      camera: optionalText(metadata.camera, "metadata.camera"),
      lens: optionalText(metadata.lens, "metadata.lens"),
      focalLength: optionalText(metadata.focalLength, "metadata.focalLength"),
      aperture: optionalText(metadata.aperture, "metadata.aperture"),
      shutter: optionalText(metadata.shutter, "metadata.shutter"),
      iso: optionalNumber(metadata.iso, "metadata.iso"),
      software: optionalText(metadata.software, "metadata.software"),
      palette: textList(metadata.palette, "metadata.palette"),
    },
    model: text(input.model, "model"),
  };
}

function parseImage(value: unknown): { file: string; bytes: Buffer } {
  if (typeof value !== "string") {
    invalid(`"imageUrl" must be the photo as a data URL.`);
  }
  if (value.length > MAX_IMAGE_DATA_URL_LENGTH) invalid("The photo is too large.");
  const match = IMAGE_DATA_URL_PATTERN.exec(value);
  if (!match) invalid(`"imageUrl" must be a JPEG, PNG or WEBP data URL.`);
  return {
    file: IMAGE_FILES[match[1] as ImageType],
    bytes: Buffer.from(match[2], "base64"),
  };
}

/**
 * The thumbnail a new reference brings, or null when it brings none. Only a
 * data URL is a picture to store; anything else, such as the address of a
 * thumbnail that is already stored, is passed over.
 */
function parseThumbnail(value: unknown): { file: string; bytes: Buffer } | null {
  if (typeof value !== "string" || !value.startsWith("data:")) return null;
  if (value.length > MAX_IMAGE_DATA_URL_LENGTH) invalid("The thumbnail is too large.");
  const match = IMAGE_DATA_URL_PATTERN.exec(value);
  if (!match) invalid(`"thumbnailUrl" must be a JPEG, PNG or WEBP data URL.`);
  return {
    file: THUMBNAIL_FILES[match[1] as ImageType],
    bytes: Buffer.from(match[2], "base64"),
  };
}

/** The reference's thumbnail file, or null when it was stored without one. */
async function thumbnailPath(id: string): Promise<string | null> {
  for (const file of Object.values(THUMBNAIL_FILES)) {
    const candidate = path.join(referenceDir(id), file);
    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      if (!hasCode(error, "ENOENT", "ENOTDIR")) throw error;
    }
  }
  return null;
}

/** Null when the folder holds no readable reference. */
async function readReference(id: string): Promise<DesignReference | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(referenceDir(id), RECORD_FILE), "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT", "ENOTDIR")) return null;
    throw error;
  }
  try {
    // The folder name is what the URLs are built from, so it is the id.
    const fields = parseFields({ ...object(JSON.parse(raw), "reference"), id });
    return {
      ...fields,
      imageUrl: imageUrlFor(id),
      ...((await thumbnailPath(id)) ? { thumbnailUrl: thumbnailUrlFor(id) } : {}),
    };
  } catch (error) {
    // One damaged file should not take the rest of the library down with it.
    console.warn(
      `World Material Library: skipping ${path.join(referenceDir(id), RECORD_FILE)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/** Everything in the library, newest first. */
export async function listReferences(): Promise<DesignReference[]> {
  let ids: string[];
  try {
    const entries = await fs.readdir(referencesDir(), { withFileTypes: true });
    ids = entries
      .filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    // Nothing has been stored yet.
    if (hasCode(error, "ENOENT")) return [];
    throw error;
  }

  const references: DesignReference[] = [];
  for (const id of ids) {
    const reference = await readReference(id);
    if (reference) references.push(reference);
  }
  return references.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

/** Written through to the disk before returning, so a crash cannot leave a hollow file. */
async function writeFlushed(file: string, data: string | Uint8Array) {
  const handle = await fs.open(file, "wx");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Stores a reference whose `imageUrl` is the photo as a data URL.
 *
 * An id that is already on disk is left untouched and returned as stored, so
 * repeating a request is safe. Throws InvalidReferenceError for bad input.
 */
export async function createReference(
  input: unknown,
): Promise<{ reference: DesignReference; created: boolean }> {
  const fields = parseFields(input);
  const image = parseImage(object(input, "reference").imageUrl);
  const thumbnail = parseThumbnail(object(input, "reference").thumbnailUrl);

  const existing = await readReference(fields.id);
  if (existing) return { reference: existing, created: false };

  // Build the folder under a temporary name and rename it into place: the
  // reference appears complete or not at all, and listing ignores dot-folders.
  const staging = path.join(
    referencesDir(),
    `.tmp-${fields.id}-${randomUUID()}`,
  );
  await fs.mkdir(staging, { recursive: true });
  try {
    await writeFlushed(path.join(staging, image.file), image.bytes);
    if (thumbnail) {
      await writeFlushed(path.join(staging, thumbnail.file), thumbnail.bytes);
    }
    await writeFlushed(
      path.join(staging, RECORD_FILE),
      `${JSON.stringify(fields, null, 2)}\n`,
    );
    await fs.rename(staging, referenceDir(fields.id));
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    // Losing a race against a request for the same id is not a failure.
    const winner = await readReference(fields.id);
    if (winner) return { reference: winner, created: false };
    throw error;
  }
  return {
    reference: {
      ...fields,
      imageUrl: imageUrlFor(fields.id),
      ...(thumbnail ? { thumbnailUrl: thumbnailUrlFor(fields.id) } : {}),
    },
    created: true,
  };
}

/** The stored photo, or null when there is no such reference. */
export async function readReferenceImage(
  id: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!ID_PATTERN.test(id)) return null;
  for (const [contentType, file] of Object.entries(IMAGE_FILES)) {
    try {
      const bytes = await fs.readFile(path.join(referenceDir(id), file));
      return { bytes, contentType };
    } catch (error) {
      if (!hasCode(error, "ENOENT", "ENOTDIR")) throw error;
    }
  }
  return null;
}

/** The stored thumbnail, or null when the reference has none. */
export async function readReferenceThumbnail(
  id: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!ID_PATTERN.test(id)) return null;
  for (const [contentType, file] of Object.entries(THUMBNAIL_FILES)) {
    try {
      const bytes = await fs.readFile(path.join(referenceDir(id), file));
      return { bytes, contentType };
    } catch (error) {
      if (!hasCode(error, "ENOENT", "ENOTDIR")) throw error;
    }
  }
  return null;
}

/**
 * The reference's embedding file as text, or null when it has none. The file
 * is derived from the reference and can be deleted: search rebuilds it.
 */
export async function readReferenceEmbedding(id: string): Promise<string | null> {
  if (!ID_PATTERN.test(id)) return null;
  try {
    return await fs.readFile(path.join(referenceDir(id), EMBEDDING_FILE), "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT", "ENOTDIR")) return null;
    throw error;
  }
}

/** Replaces the reference's embedding file; a no-op if the reference is gone. */
export async function writeReferenceEmbedding(
  id: string,
  content: string,
): Promise<void> {
  if (!ID_PATTERN.test(id)) return;
  const folder = referenceDir(id);
  const staging = path.join(folder, `.${EMBEDDING_FILE}-${randomUUID()}`);
  try {
    await fs.writeFile(staging, content, { flag: "wx" });
    await fs.rename(staging, path.join(folder, EMBEDDING_FILE));
  } catch (error) {
    await fs.rm(staging, { force: true });
    if (!hasCode(error, "ENOENT", "ENOTDIR")) throw error;
  }
}

/** True for errors that came from the file system rather than from a bug. */
export function isStorageError(error: unknown): boolean {
  return (
    error instanceof Error &&
    typeof (error as NodeJS.ErrnoException).code === "string" &&
    typeof (error as NodeJS.ErrnoException).syscall === "string"
  );
}

/** A sentence for the user when the data folder cannot be read or written. */
export function describeStorageError(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `The library folder (${dataDir()}) is not usable: ${reason}`;
}
