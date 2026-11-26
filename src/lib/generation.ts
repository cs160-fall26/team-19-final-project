import type { Chat, DesignReference, PastedImage } from "@/lib/types";

/** Stands in for the nth reference's image (1-based) inside generated HTML. */
export const referenceImageToken = (n: number) => `{{REFERENCE_IMAGE_${n}}}`;

const TOKEN_PATTERN = /\{\{REFERENCE_IMAGE_(\d+)\}\}/g;

/** What the model is told about one reference. */
export type GenerationReference = {
  /**
   * The reference's image as a data URL. Left out on a revision when the
   * model already used it, which keeps revisions quick.
   */
  image?: string;
  title: string;
  semantic: string;
  labels: string[];
  palette: string[];
  note?: string;
};

export type GenerationRequest = {
  references: GenerationReference[];
  /** The designer's earlier messages in this chat, oldest first. */
  history?: string[];
  brief: string;
  /** When revising, the HTML being revised. */
  previous?: string;
};

export type GenerationResult = { html: string; model: string };

/** What /api/generate streams back, one JSON object per line. */
export type GenerationEvent =
  | { type: "status"; text: string }
  /** A piece of the model's reply as it is written. */
  | { type: "text"; text: string }
  /** The reply so far is discarded; a fresh one follows. */
  | { type: "restart"; text: string }
  | { type: "done"; html: string; model: string }
  | { type: "error"; error: string };

/** One entry of a chat's reference list: from the library or pasted in. */
export type ChatReference = GenerationReference & {
  id: string;
  image: string;
  pasted: boolean;
};

/** Pasted images are named after their position, since they have no catalogue entry. */
const pastedReference = (image: PastedImage): ChatReference => ({
  id: image.id,
  image: image.dataUrl,
  title: image.name ? `Pasted image (${image.name})` : "Pasted image",
  semantic: "",
  labels: [],
  palette: [],
  pasted: true,
});

/**
 * Every reference attached anywhere in the chat, in the order first attached.
 * Reference n in the model's prompt and in image tokens is entry n - 1, so
 * this list only ever grows.
 */
export function chatReferenceIds(chat: Pick<Chat, "messages">): string[] {
  const ids: string[] = [];
  for (const message of chat.messages) {
    if (message.role !== "user") continue;
    for (const id of message.referenceIds) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The image the model sees and the generated page shows: the crop if there is one. */
export const referenceImage = (ref: DesignReference) =>
  ref.thumbnailUrl ?? ref.imageUrl;

export const libraryReference = (ref: DesignReference): ChatReference => ({
  id: ref.id,
  image: referenceImage(ref),
  title: ref.title,
  semantic: ref.semantic,
  labels: ref.labels,
  palette: ref.metadata.palette,
  note: ref.note,
  pasted: false,
});

/**
 * Looks up a reference id from a chat: a library reference, or an image
 * pasted into one of its messages (or waiting in the composer).
 */
export function resolveReference(
  id: string,
  getById: (id: string) => DesignReference | undefined,
  pasted: PastedImage[],
): ChatReference | null {
  const ref = getById(id);
  if (ref) return libraryReference(ref);
  const image = pasted.find((p) => p.id === id);
  return image ? pastedReference(image) : null;
}

/** Every image pasted anywhere in the chat. */
export const chatPastedImages = (chat: Pick<Chat, "messages">): PastedImage[] =>
  chat.messages.flatMap((m) => (m.role === "user" ? (m.pastedImages ?? []) : []));

/** Reads a pasted or dropped image, downscaled to a JPEG data URL. */
export async function imageFileToPasted(file: File): Promise<PastedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available in this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return {
      id: `paste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      dataUrl: canvas.toDataURL("image/jpeg", 0.85),
      name: file.name && file.name !== "image.png" ? file.name : undefined,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Swaps each token for its reference's image so the HTML stands on its own.
 * A token whose reference is gone becomes an empty source.
 */
export const withReferenceImages = (html: string, images: string[]) =>
  html.replace(TOKEN_PATTERN, (_, n: string) => images[Number(n) - 1] ?? "");

/**
 * Streams a generation. onEvent sees progress as the model writes; the
 * promise resolves with the finished page or rejects with a readable message.
 */
export async function requestGeneration(
  input: GenerationRequest,
  onEvent?: (event: GenerationEvent) => void,
): Promise<GenerationResult> {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Generation failed (HTTP ${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line) as GenerationEvent;
      if (event.type === "done") return { html: event.html, model: event.model };
      if (event.type === "error") throw new Error(event.error);
      onEvent?.(event);
    }
    if (done) break;
  }
  throw new Error("The connection closed before the design was finished.");
}

const PENDING_KEY = "wml:generate-references";

/** Hands a library selection to the Generate page, which attaches it to a new chat. */
export function stashReferencesForGenerate(ids: string[]) {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(ids));
  } catch {
    // Storage blocked: the Generate page simply opens with nothing attached.
  }
}

/** Reads and clears what the library handed over. */
export function takeStashedReferences(): string[] {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** The reverse of withReferenceImages, so saved HTML stays small. */
export function withReferenceTokens(html: string, images: string[]): string {
  let out = html;
  images.forEach((image, i) => {
    if (image) out = out.split(image).join(referenceImageToken(i + 1));
  });
  return out;
}
