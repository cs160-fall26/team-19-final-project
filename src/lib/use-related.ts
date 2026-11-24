import { useEffect, useMemo, useState } from "react";
import type { RelatedReference } from "@/lib/semantic-search";

export type RelatedSearch =
  /** The query is too short to mean anything. */
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; results: RelatedReference[] }
  | { status: "failed"; error: string };

/** Wait this long after the last keystroke before asking the server. */
const PAUSE_MS = 350;
const MIN_QUERY_LENGTH = 2;

type Answer = { query: string; results?: RelatedReference[]; error?: string };

const IDLE: RelatedSearch = { status: "idle" };
const LOADING: RelatedSearch = { status: "loading" };

async function fetchRelated(
  query: string,
  signal: AbortSignal,
): Promise<RelatedReference[]> {
  let response: Response;
  try {
    response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
      signal,
      cache: "no-store",
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new Error("The Spar server did not answer.");
  }
  const body = (await response.json().catch(() => null)) as {
    results?: RelatedReference[];
    error?: string;
  } | null;
  if (!response.ok || !body || body.error || !Array.isArray(body.results)) {
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }
  return body.results;
}

/**
 * References related in meaning to the query, from /api/search. Asks once the
 * typing pauses, and drops answers to questions that are no longer current.
 */
export function useRelated(query: string): RelatedSearch {
  const wanted = query.trim().replace(/\s+/g, " ");
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (wanted.length < MIN_QUERY_LENGTH) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchRelated(wanted, controller.signal)
        .then((results) => setAnswer({ query: wanted, results }))
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setAnswer({
            query: wanted,
            error: cause instanceof Error ? cause.message : "Unknown error.",
          });
        });
    }, PAUSE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [wanted]);

  // The same object until the answer changes, so callers can memoize on it.
  return useMemo<RelatedSearch>(() => {
    if (wanted.length < MIN_QUERY_LENGTH) return IDLE;
    if (!answer || answer.query !== wanted) return LOADING;
    return answer.error !== undefined
      ? { status: "failed", error: answer.error }
      : { status: "done", results: answer.results ?? [] };
  }, [wanted, answer]);
}
