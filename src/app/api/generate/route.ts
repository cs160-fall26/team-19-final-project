import { referenceImageToken, type GenerationEvent } from "@/lib/generation";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-4-hydrogen";
const MAX_DATA_URL_LENGTH = 8_000_000;
const MAX_TEXT = 2_000;
const MAX_PREVIOUS_HTML = 200_000;
const MAX_HISTORY = 50;
const DATA_URL_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const SYSTEM_PROMPT = `You are a senior visual designer who works in HTML and CSS.
You receive a brief and, usually, one or more numbered design references: each is an image (an element a designer boxed in a photo, or an image they pasted), with any notes about it. Make the design the brief asks for, drawing form, material, colour and character from the references. With no references, work from the brief alone.

Write one complete, self-contained HTML document.
- Put all CSS in a <style> element. Scripts are allowed but rarely needed.
- You may load fonts from Google Fonts with a <link>. Load nothing else from the network.
- To show reference n's image itself, use the exact text ${referenceImageToken(1).replace("1", "n")} (for example ${referenceImageToken(1)} for reference 1) as an image source, e.g. <img src="${referenceImageToken(1)}" alt="">, or in CSS url("${referenceImageToken(1)}"). Each is that reference's image; you may crop, mask, filter, blend or repeat it. Use it when the brief calls for the element itself (for example as a logo mark); otherwise you may redraw the element with CSS or inline SVG. Never invent other image sources.
- The designer will rearrange the result by hand, so build it from separate, editable pieces: every visual element (each block of text, each shape, each image, each decorative motif) is its own HTML or inline SVG element. Never draw the design onto a <canvas>, never flatten it into one image or one background, and keep text as live text. Put data-layer="short name" on each piece a designer would want to move, e.g. data-layer="headline", data-layer="fish", data-layer="star".
- Keep the code compact: aim for under 12,000 characters. Write terse CSS (shared classes, no comments, no unused rules), draw motifs with a few SVG paths rather than many repeated elements, and make textures and halftones with CSS gradients or one SVG pattern rather than individual dots.
- The page is shown in a frame of unknown size. Fill the viewport (html and body at 100% height, no margin), centre the design, and keep it legible from about 360px to 1600px wide.
- Do not invent facts about a real brand, place or maker. Use text from the brief; when the brief asks for a name it does not give, invent a fitting fictional one.`;

const FULL_PAGE_REPLY = `Reply with the complete HTML document only: no explanation, no Markdown fences.`;

// Small changes come back as find/replace edits instead of a whole new page,
// which is most of the time saved on a revision.
const EDIT_REPLY = `Reply with only the edits that make this change, in this exact form, one block per edit:
<<<FIND
text copied exactly from the current HTML, long enough to occur only once
===
the text to put in its place
>>>
Use as many blocks as you need and nothing else: no explanation, no fences. If the change rewrites most of the page, reply instead with the complete new HTML document.`;

const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 24 &&
  value.every((item) => isText(item, 64));

type ReferenceInput = {
  /** Left out when the model already saw it earlier in the chat. */
  image?: string;
  title: string;
  semantic: string;
  labels: string[];
  palette: string[];
  note?: string;
};

function isReference(value: unknown): value is ReferenceInput {
  if (!value || typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  return (
    (ref.image === undefined ||
      (typeof ref.image === "string" &&
        ref.image.length <= MAX_DATA_URL_LENGTH &&
        DATA_URL_PATTERN.test(ref.image))) &&
    isText(ref.title, 200) &&
    isText(ref.semantic, MAX_TEXT) &&
    isStringList(ref.labels) &&
    isStringList(ref.palette) &&
    (ref.note === undefined || isText(ref.note, 500))
  );
}

/** Models sometimes wrap the page in a code fence or add a sentence around it. */
function extractHtml(content: string): string | null {
  const fenced = content.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : content).trim();
  const start = text.search(/<!doctype html|<html[\s>]/i);
  if (start === -1) return null;
  const end = text.toLowerCase().lastIndexOf("</html>");
  return end === -1 ? text.slice(start) : text.slice(start, end + "</html>".length);
}

const EDIT_BLOCK = /<<<FIND\r?\n([\s\S]*?)\r?\n===\r?\n([\s\S]*?)\r?\n?>>>/g;

/** Applies find/replace edits; null when any FIND is missing or ambiguous. */
function applyEdits(html: string, content: string): string | null {
  const edits = [...content.matchAll(EDIT_BLOCK)];
  if (edits.length === 0) return null;
  let out = html;
  for (const [, find, replace] of edits) {
    const at = out.indexOf(find);
    if (at === -1 || out.indexOf(find, at + 1) !== -1) return null;
    out = out.slice(0, at) + replace + out.slice(at + find.length);
  }
  return out;
}

type Completion = { content: string; model: string; truncated: boolean };

/** Streams one OpenRouter completion, reporting text as it arrives. */
async function streamCompletion(
  apiKey: string,
  model: string,
  messages: unknown[],
  onText: (text: string) => void,
): Promise<Completion> {
  const upstream = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "World Material Library",
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 24_000,
      stream: true,
      messages,
    }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!upstream.ok || !upstream.body) {
    const payload = (await upstream.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(
      `OpenRouter (${model}): ${payload?.error?.message ?? `HTTP ${upstream.status}`}`,
    );
  }

  let content = "";
  let usedModel = model;
  let truncated = false;
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:") || line === "data: [DONE]") continue;
      const event = JSON.parse(line.slice(5)) as {
        model?: string;
        error?: { message?: string };
        choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
      };
      if (event.error) {
        throw new Error(`OpenRouter (${model}): ${event.error.message ?? "stream error"}`);
      }
      if (event.model) usedModel = event.model;
      const choice = event.choices?.[0];
      const text = choice?.delta?.content;
      if (text) {
        content += text;
        onText(text);
      }
      if (choice?.finish_reason === "length") truncated = true;
    }
  }
  return { content, model: usedModel, truncated };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENROUTER_API_KEY is not set. Add it to .env.local in the project root." },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const references = body?.references;
  if (
    !body ||
    !Array.isArray(references) ||
    !references.every(isReference) ||
    (body.history !== undefined &&
      !(
        Array.isArray(body.history) &&
        body.history.length <= MAX_HISTORY &&
        body.history.every((item) => isText(item, MAX_TEXT))
      )) ||
    (body.previous !== undefined && !isText(body.previous, MAX_PREVIOUS_HTML))
  ) {
    return Response.json(
      { error: "Expected a brief and a list of references." },
      { status: 400 },
    );
  }
  if (!isText(body.brief, MAX_TEXT) || !body.brief.trim()) {
    return Response.json(
      { error: "Write a brief saying what to generate." },
      { status: 400 },
    );
  }
  const brief = body.brief.trim();

  // Each reference: its notes, then its image when sent, so the model can pair them.
  const referenceParts = references.flatMap((ref, index) => {
    const n = index + 1;
    const notes = [
      `Reference ${n}: ${ref.title}`,
      ref.semantic ? `Description: ${ref.semantic}` : "",
      ref.labels.length ? `Labels: ${ref.labels.join(", ")}` : "",
      ref.palette.length ? `Palette: ${ref.palette.join(", ")}` : "",
      ref.note ? `What the designer wanted from it: ${ref.note}` : "",
      ref.image
        ? `Its image (use ${referenceImageToken(n)} to place it):`
        : `Place its image with ${referenceImageToken(n)}; it is already in the current design where used.`,
    ]
      .filter(Boolean)
      .join("\n");
    return ref.image
      ? [
          { type: "text", text: notes },
          { type: "image_url", image_url: { url: ref.image } },
        ]
      : [{ type: "text", text: notes }];
  });

  const history = (body.history as string[] | undefined) ?? [];
  const earlier = history.length
    ? `Earlier in this conversation the designer asked, in order:\n${history.map((h, i) => `${i + 1}. ${h}`).join("\n")}\n\n`
    : "";
  const previous = typeof body.previous === "string" ? body.previous : undefined;

  const messagesFor = (mode: "full" | "edit") => {
    const task = previous
      ? `${earlier}Revise the current design for the designer's latest message. Keep what the message does not ask to change.\n\nCurrent HTML:\n${previous}\n\nLatest message:\n${brief}\n\n${mode === "edit" ? EDIT_REPLY : FULL_PAGE_REPLY}`
      : `${earlier}Brief:\n${brief}\n\n${FULL_PAGE_REPLY}`;
    return [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: references.length
              ? `${references.length} reference${references.length === 1 ? "" : "s"} follow.`
              : "No references were chosen; work from the brief alone.",
          },
          ...referenceParts,
          { type: "text", text: task },
        ],
      },
    ];
  };

  const model =
    process.env.OPENROUTER_GENERATE_MODEL ||
    process.env.OPENROUTER_MODEL ||
    DEFAULT_MODEL;

  // Newline-delimited JSON events, so the page can show progress as it is written.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: GenerationEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const onText = (text: string) => send({ type: "text", text });
      try {
        if (previous) {
          send({ type: "status", text: "Working out the changes…" });
          const reply = await streamCompletion(apiKey, model, messagesFor("edit"), onText);
          const edited = reply.truncated ? null : applyEdits(previous, reply.content);
          const whole = reply.truncated ? null : extractHtml(reply.content);
          if (edited ?? whole) {
            send({ type: "done", html: (edited ?? whole)!, model: reply.model });
            return;
          }
          // The edits did not line up with the page: ask for the whole page instead.
          send({ type: "restart", text: "Rewriting the full page…" });
        }
        const reply = await streamCompletion(apiKey, model, messagesFor("full"), onText);
        const html = extractHtml(reply.content);
        if (reply.truncated) {
          send({
            type: "error",
            error: "The design was too long and got cut off. Try asking for something simpler.",
          });
        } else if (!html) {
          send({ type: "error", error: `OpenRouter (${model}) did not return an HTML page.` });
        } else {
          send({ type: "done", html, model: reply.model });
        }
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        send({
          type: "error",
          error: timedOut
            ? "OpenRouter did not finish within 4 minutes."
            : error instanceof Error
              ? error.message
              : "Could not reach OpenRouter.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
