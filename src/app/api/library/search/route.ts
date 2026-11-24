import { execFile } from "node:child_process";
import path from "node:path";
import type { NextRequest } from "next/server";
import { dataDir } from "@/lib/reference-store";

/**
 * Search for agents: references, parts or both, optionally only some file
 * formats. It answers with what skills/gallery/find.js prints, because it runs
 * that script: an agent gets the same results from this route and from the
 * command line.
 *
 *   /api/library/search?q=quiet+background&in=parts&format=svg&limit=5&files=1
 *
 *   q       words that all have to match; without it everything is listed
 *   in      parts, references or both (the default)
 *   format  svg, html or image, separated by commas
 *   limit   how many results at most (10, up to 50)
 *   files   1 to include the text of each part's editable file
 */

const SCRIPT = ["skills", "gallery", "find.js"];
const SCOPES = ["parts", "references", "both"];
const FORMATS = ["svg", "html", "image"];
const MAX_QUERY_LENGTH = 200;
const MAX_LIMIT = 50;

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [path.resolve(...SCRIPT), ...args],
      // Parts' files can be large when they are asked for.
      { maxBuffer: 64 * 1024 * 1024, timeout: 30_000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = (params.get("q") ?? "").trim().replace(/\s+/g, " ");
  if (query.length > MAX_QUERY_LENGTH) {
    return fail(400, `The query is longer than ${MAX_QUERY_LENGTH} characters.`);
  }
  const scope = params.get("in") ?? "both";
  if (!SCOPES.includes(scope)) {
    return fail(400, `"in" is one of: ${SCOPES.join(", ")}.`);
  }
  const formats = (params.get("format") ?? "")
    .split(",")
    .map((format) => format.trim().toLowerCase())
    .filter(Boolean);
  const unknown = formats.filter((format) => !FORMATS.includes(format));
  if (unknown.length > 0) {
    return fail(
      400,
      `Unknown format: ${unknown.join(", ")}. Formats are: ${FORMATS.join(", ")}.`,
    );
  }
  const limit = Number(params.get("limit") ?? 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return fail(400, `"limit" is a whole number from 1 to ${MAX_LIMIT}.`);
  }

  const args = ["--json", "--data", dataDir(), "--in", scope, "--limit", String(limit)];
  if (formats.length > 0) args.push("--format", formats.join(","));
  if (params.get("files") === "1") args.push("--files");
  // After "--" everything is a word to look for, whatever it begins with.
  if (query) args.push("--", ...query.split(" "));

  try {
    return new Response(await run(args), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return fail(500, "The library search could not be run.");
  }
}
