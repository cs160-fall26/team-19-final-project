import { readReferenceImage } from "@/lib/reference-store";

/** The stored photo of one reference. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let image: Awaited<ReturnType<typeof readReferenceImage>>;
  try {
    image = await readReferenceImage(id);
  } catch {
    return new Response("The photo could not be read.", { status: 500 });
  }
  if (!image) return new Response("Not found.", { status: 404 });

  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      // A stored photo never changes, so the browser can keep it.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
