import { readReferenceThumbnail } from "@/lib/reference-store";

/** The boxed region of one reference on its own, as the library grid shows it. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let thumbnail: Awaited<ReturnType<typeof readReferenceThumbnail>>;
  try {
    thumbnail = await readReferenceThumbnail(id);
  } catch {
    return new Response("The thumbnail could not be read.", { status: 500 });
  }
  if (!thumbnail) return new Response("Not found.", { status: 404 });

  return new Response(new Uint8Array(thumbnail.bytes), {
    headers: {
      "Content-Type": thumbnail.contentType,
      // A stored thumbnail never changes, so the browser can keep it.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
