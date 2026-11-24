import type { NextRequest } from "next/server";
import { describeStorageError, isStorageError } from "@/lib/reference-store";
import {
  findRelated,
  MAX_QUERY_LENGTH,
  SemanticSearchError,
} from "@/lib/semantic-search";

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

/**
 * References related in meaning to `q`, best first, as `{ id, score }`.
 * Keyword matching happens in the browser; this adds what it cannot see.
 */
export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!query) return fail(400, "Expected a search query in `q`.");
  if (query.length > MAX_QUERY_LENGTH) {
    return fail(400, `The query is longer than ${MAX_QUERY_LENGTH} characters.`);
  }

  try {
    return Response.json(await findRelated(query), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SemanticSearchError) {
      return fail(error.status, error.message);
    }
    if (isStorageError(error)) return fail(500, describeStorageError(error));
    return fail(500, "The related search failed unexpectedly.");
  }
}
