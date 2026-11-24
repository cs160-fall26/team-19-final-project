import { describeStorageError, isStorageError } from "@/lib/reference-store";
import { listParts } from "@/lib/study-store";

/**
 * Every part that deep analyses have taken out of the library's references,
 * each with the reference it came from. The library page searches these in
 * the browser, the way it searches references.
 */
export async function GET() {
  try {
    return Response.json(
      { parts: await listParts() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error: isStorageError(error)
          ? describeStorageError(error)
          : "The parts could not be listed.",
      },
      { status: 500 },
    );
  }
}
