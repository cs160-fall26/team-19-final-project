import { describeStorageError, isStorageError } from "@/lib/reference-store";
import { readStudySource } from "@/lib/study-store";

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

/**
 * The text of a part's editable file, and of the function that writes it when
 * it has one. It comes as JSON, to be shown and copied as text, never as a
 * page or an image: an agent wrote it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; part: string }> },
) {
  const { id, part } = await params;
  try {
    const source = await readStudySource(id, part);
    if (!source) return fail(404, "This part has no editable file.");
    return Response.json(source, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isStorageError(error)) return fail(500, describeStorageError(error));
    return fail(500, "The part's file could not be read.");
  }
}
