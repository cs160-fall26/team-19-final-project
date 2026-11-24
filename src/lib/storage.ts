import type { DesignReference } from "@/lib/types";

// The library lives on disk, behind the server's /api/references routes
// (src/lib/reference-store.ts), so it does not depend on this browser.

/** Calls one of the app's routes and returns its JSON, or throws with a sentence for the user. */
export async function call<T>(
  failure: string,
  input: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Error(`${failure}: the World Material Library server did not answer.`);
  }
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !body || body.error) {
    throw new Error(body?.error ?? `${failure} (HTTP ${response.status}).`);
  }
  return body;
}

/** The stored library, newest first. */
export async function loadReferences(): Promise<DesignReference[]> {
  const { references } = await call<{ references: DesignReference[] }>(
    "Could not load the library",
    "/api/references",
    { cache: "no-store" },
  );
  return references;
}

/**
 * Stores a reference whose `imageUrl` is the photo as a data URL. The stored
 * reference that comes back points at the photo's file instead.
 */
export async function saveReference(
  ref: DesignReference,
): Promise<DesignReference> {
  const { reference } = await call<{ reference: DesignReference }>(
    "Could not save the reference",
    "/api/references",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ref),
    },
  );
  return reference;
}
