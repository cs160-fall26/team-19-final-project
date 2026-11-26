import type { Searchable } from "@/lib/search";
import type { LibraryPart } from "@/lib/study";

/** A part in the shape the keyword search reads. */
export type SearchablePart = Searchable & { part: LibraryPart };

/**
 * Parts as the keyword search sees them. A part's keywords count as its
 * labels and its name as its title. What it answers and when to use it are
 * its description, and so, counting no more, is the image it came from: a
 * search for a job should not be drowned by subjects.
 *
 * Give the search the same objects each time, since it indexes each once.
 */
export function searchableParts(parts: LibraryPart[]): SearchablePart[] {
  return parts.map((part) => ({
    part,
    title: part.name,
    labels: part.keywords,
    semantic: [...part.answers, part.use, part.unusual, part.aspect].join(" "),
    prompt: `${part.reference.title} ${part.reference.labels.join(" ")}`,
    addedAt: part.reference.addedAt,
  }));
}
