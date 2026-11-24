import { readStudyPicture } from "@/lib/study-store";

/**
 * One picture of a part from the reference's study: `<part>.png` (the part),
 * `<part>.crop.png` (the region it came from), `<part>.check.png` (the two
 * compared) or `<part>.v1.png` to `.v3.png` (its variants).
 *
 * Only pictures are served. The part's editable file was written by an agent,
 * and opened as a page here it would run with this app's rights.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;

  let picture: Buffer | null;
  try {
    picture = await readStudyPicture(id, file);
  } catch {
    return new Response("The picture could not be read.", { status: 500 });
  }
  if (!picture) return new Response("Not found.", { status: 404 });

  return new Response(new Uint8Array(picture), {
    headers: {
      "Content-Type": "image/png",
      // The page asks with a version that changes when the study is run again.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
