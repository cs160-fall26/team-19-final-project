import type { VisionExtraction } from "@/lib/extraction";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-4-hydrogen";
const MAX_DATA_URL_LENGTH = 8_000_000;
const DATA_URL_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const SYSTEM_PROMPT = `You catalogue design references for designers.
You receive two images: first the whole photograph, then a crop of the region the designer boxed.
Describe the boxed element only, using the whole photograph for context.
Report what is visible. Do not guess the place, the maker, the brand or the date unless it is legible in the image.`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "labels", "semantic", "prompt"],
  properties: {
    title: {
      type: "string",
      description: "Name of the boxed element, 2 to 6 words, sentence case.",
    },
    labels: {
      type: "array",
      description:
        "4 to 6 lowercase tags covering object type, material, colour, style and technique.",
      items: { type: "string" },
    },
    semantic: {
      type: "string",
      description:
        "2 to 4 sentences on form, material, colour, texture, light and what makes the element distinctive as a design reference.",
    },
    prompt: {
      type: "string",
      description:
        "A single comma-separated prompt that would make an image generator reproduce this element: subject, materials, colours, lighting, composition, style.",
    },
  },
} as const;

function isUnit(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function isImageDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_DATA_URL_LENGTH &&
    DATA_URL_PATTERN.test(value)
  );
}

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

function parseModelJson(content: string): unknown {
  const unfenced = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(unfenced);
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return fail(
      500,
      "OPENROUTER_API_KEY is not set. Add it to .env.local in the project root.",
    );
  }

  const body = (await request.json().catch(() => null)) as {
    image?: unknown;
    crop?: unknown;
    box?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  } | null;
  const box = body?.box;
  if (
    !body ||
    !isImageDataUrl(body.image) ||
    !isImageDataUrl(body.crop) ||
    !box ||
    !isUnit(box.x) ||
    !isUnit(box.y) ||
    !isUnit(box.width) ||
    !isUnit(box.height)
  ) {
    return fail(400, "Expected an image, a crop and a bounding box.");
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const percent = (n: number) => `${Math.round(n * 100)}%`;
  const instruction = `The boxed region starts ${percent(box.x)} from the left and ${percent(box.y)} from the top of the photograph, and spans ${percent(box.width)} of its width and ${percent(box.height)} of its height. The second image is that region.`;

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "World Material Library",
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: instruction },
              { type: "image_url", image_url: { url: body.image } },
              { type: "image_url", image_url: { url: body.crop } },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "design_reference",
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return fail(
      504,
      timedOut
        ? "OpenRouter did not answer within 90 seconds."
        : "Could not reach OpenRouter.",
    );
  }

  const payload = (await upstream.json().catch(() => null)) as {
    error?: { message?: string };
    model?: string;
    choices?: { message?: { content?: unknown } }[];
  } | null;

  if (!upstream.ok || payload?.error) {
    const reason = payload?.error?.message ?? `HTTP ${upstream.status}`;
    return fail(502, `OpenRouter (${model}): ${reason}`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    return fail(502, `OpenRouter (${model}) returned no description.`);
  }

  let parsed: Partial<VisionExtraction>;
  try {
    parsed = parseModelJson(content) as Partial<VisionExtraction>;
  } catch {
    return fail(502, `OpenRouter (${model}) returned text that is not JSON.`);
  }

  const labels = Array.isArray(parsed.labels)
    ? parsed.labels
        .filter((label): label is string => typeof label === "string")
        .map((label) => label.trim().toLowerCase())
        .filter(Boolean)
    : [];
  if (
    typeof parsed.title !== "string" ||
    typeof parsed.semantic !== "string" ||
    typeof parsed.prompt !== "string" ||
    !parsed.title.trim() ||
    !parsed.semantic.trim() ||
    !parsed.prompt.trim() ||
    labels.length === 0
  ) {
    return fail(502, `OpenRouter (${model}) returned an incomplete description.`);
  }

  const result: VisionExtraction = {
    title: parsed.title.trim(),
    labels: Array.from(new Set(labels)),
    semantic: parsed.semantic.trim(),
    prompt: parsed.prompt.trim(),
    model: payload?.model ?? model,
  };
  return Response.json(result);
}
