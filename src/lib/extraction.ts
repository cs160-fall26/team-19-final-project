import type { BoundingBox } from "@/lib/types";

/** What the vision model writes about the boxed element. */
export type VisionExtraction = {
  title: string;
  labels: string[];
  semantic: string;
  prompt: string;
  /** The main things visible anywhere in the whole photo. */
  inPhoto: string[];
  model: string;
};

export type ExtractionRequest = {
  /** Whole photo as a data URL. */
  image: string;
  /** The boxed region on its own, as a data URL. */
  crop: string;
  box: BoundingBox;
  /** The designer's optional note on what they want from the box. */
  note?: string;
};

/**
 * Sends the photo to the server route, which holds the OpenRouter key.
 * Rejects with a readable message when the route or the model fails.
 */
export async function requestExtraction(
  input: ExtractionRequest,
): Promise<VisionExtraction> {
  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => null)) as
    | (Partial<VisionExtraction> & { error?: string })
    | null;
  if (!response.ok || !body || body.error) {
    throw new Error(
      body?.error ?? `Extraction failed (HTTP ${response.status}).`,
    );
  }
  return body as VisionExtraction;
}
