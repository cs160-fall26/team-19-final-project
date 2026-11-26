import { describeStorageError, isStorageError } from "@/lib/reference-store";
import { MAX_STUDY_NOTE_LENGTH } from "@/lib/study";
import {
  readStudyState,
  startStudy,
  stopStudy,
  StudyRequestError,
} from "@/lib/study-store";

type Context = { params: Promise<{ id: string }> };

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

function failure(error: unknown) {
  if (error instanceof StudyRequestError) return fail(error.status, error.message);
  if (isStorageError(error)) return fail(500, describeStorageError(error));
  return fail(500, "The deep analysis failed unexpectedly.");
}

/**
 * A run spends the owner's Codex allowance, so only the app's own pages may start
 * or stop one. A browser says where a request comes from; a tool on this
 * machine (curl, an agent) sends neither header and is let through.
 */
function fromAnotherSite(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    return true;
  }
}

/** Where deep analysis stands for this reference: the latest run and the saved study. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  try {
    const state = await readStudyState(id);
    if (!state) return fail(404, "No such reference.");
    return Response.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Starts a run. The body may carry `note`: what the owner likes about the
 * reference, in their words. Answers at once; the run takes minutes, and GET
 * reports how it is going.
 */
export async function POST(request: Request, { params }: Context) {
  if (fromAnotherSite(request)) {
    return fail(403, "Deep analysis can only be started from World Material Library itself.");
  }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { note?: unknown } | null;
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (note.length > MAX_STUDY_NOTE_LENGTH) {
    return fail(400, `The note is longer than ${MAX_STUDY_NOTE_LENGTH} characters.`);
  }
  try {
    const state = await startStudy(id, note);
    return Response.json(state, {
      status: state.job?.status === "running" ? 202 : 200,
    });
  } catch (error) {
    return failure(error);
  }
}

/** Stops the run, if one is working. */
export async function DELETE(request: Request, { params }: Context) {
  if (fromAnotherSite(request)) {
    return fail(403, "Deep analysis can only be stopped from World Material Library itself.");
  }
  const { id } = await params;
  try {
    return Response.json(await stopStudy(id));
  } catch (error) {
    return failure(error);
  }
}
