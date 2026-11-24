import { useEffect, useMemo, useState } from "react";
import { loadParts, type LibraryPart } from "@/lib/study";

export type PartsLoad =
  /** Nobody has asked for the parts yet. */
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; parts: LibraryPart[] }
  | { status: "failed"; error: string };

type Answer = { parts?: LibraryPart[]; error?: string };

const IDLE: PartsLoad = { status: "idle" };
const LOADING: PartsLoad = { status: "loading" };

/**
 * Every part in the library, from /api/parts. They are fetched when `wanted`
 * becomes true, and again each time it does, so that a deep analysis that
 * finished in the meantime shows up.
 */
export function useParts(wanted: boolean): PartsLoad {
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    loadParts().then(
      (parts) => {
        if (!cancelled) setAnswer({ parts });
      },
      (cause: unknown) => {
        if (cancelled) return;
        setAnswer({
          error: cause instanceof Error ? cause.message : "Could not load the parts.",
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  // The same object until the answer changes, so callers can memoize on it.
  return useMemo<PartsLoad>(() => {
    if (!answer) return wanted ? LOADING : IDLE;
    return answer.error !== undefined
      ? { status: "failed", error: answer.error }
      : { status: "done", parts: answer.parts ?? [] };
  }, [wanted, answer]);
}
