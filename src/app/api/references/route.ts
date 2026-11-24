import { after } from "next/server";
import {
  createReference,
  describeStorageError,
  InvalidReferenceError,
  listReferences,
  MAX_REFERENCE_BODY_BYTES,
} from "@/lib/reference-store";
import { refreshIndex } from "@/lib/semantic-search";

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

/** The whole library, newest first. Photos are served by ./[id]/image. */
export async function GET() {
  try {
    return Response.json(
      { references: await listReferences() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(500, describeStorageError(error));
  }
}

/**
 * Stores one reference. The body is the reference with its photo as a data
 * URL in `imageUrl`; the answer carries the URL the stored photo is served at.
 */
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_REFERENCE_BODY_BYTES) {
    return fail(413, "The photo is too large.");
  }
  const body: unknown = await request.json().catch(() => null);
  if (body === null) return fail(400, "Expected a reference as JSON.");

  try {
    const { reference, created } = await createReference(body);
    // Embed the new reference for search once the answer is on its way.
    if (created) after(refreshIndex);
    return Response.json({ reference }, { status: created ? 201 : 200 });
  } catch (error) {
    if (error instanceof InvalidReferenceError) return fail(400, error.message);
    return fail(500, describeStorageError(error));
  }
}
